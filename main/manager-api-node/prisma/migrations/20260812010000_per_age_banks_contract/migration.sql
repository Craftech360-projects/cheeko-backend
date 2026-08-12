-- Per-age question banks, step 3 of 3: CONTRACT.
--
-- Design: picoclaw docs/issues/per-age-banks/000-design.md, issue 005.
--
-- Run only after the 002 deploy has soaked and no session resolves an old band
-- any more. This is the step that ends the easy rollback: after it, reverting
-- ageBandFromBirthDate would point every child at inactive content.
--
-- No question row is deleted. The answer log's foreign key is RESTRICT, and
-- kid_learning_progress rows carrying old "3-5 level 1" topics stay untouched.

BEGIN;

-- 1. Drop the answer rows the 001 remap superseded.
--
-- The remap COPIED each answer onto its per-age clone rather than moving it,
-- which is what made the 002 deploy revertable. The lifetime tallies behind the
-- admin Correct column and the parent analytics are deliberately not
-- band-scoped, so every copied answer has been counted twice since (observed:
-- 22 for a child with 11 real quiz answers, 52 for 31 riddle answers). Once the
-- rollback those copies protected is gone, they are just double-counting.
--
-- Matched on the '-a%' code suffix rather than on the device's age, so a child
-- whose birthday moved them to another bank between the remap and now still has
-- their duplicate found. A row with no twin is real history, not a copy — the
-- ten riddle answers a child gave at an age whose bank was cloned from a
-- different band have no per-age equivalent, and must survive.
DELETE FROM "quiz_question_answer" a
WHERE EXISTS (
  SELECT 1
  FROM "quiz_question" old
  JOIN "quiz_question" clone ON clone.code LIKE old.code || '-a%'
  JOIN "quiz_question_answer" twin
    ON twin.device_mac = a.device_mac
   AND twin.question_id = clone.id
   AND twin.answered_at = a.answered_at
   AND twin.result = a.result
  WHERE old.id = a.question_id
    AND old.age_band IN ('3-5', '6-8', '9+')
);

DELETE FROM "riddle_question_answer" a
WHERE EXISTS (
  SELECT 1
  FROM "riddle_question" old
  JOIN "riddle_question" clone ON clone.code LIKE old.code || '-a%'
  JOIN "riddle_question_answer" twin
    ON twin.device_mac = a.device_mac
   AND twin.question_id = clone.id
   AND twin.answered_at = a.answered_at
   AND twin.result = a.result
  WHERE old.id = a.question_id
    AND old.age_band IN ('3-5', '6-8', '9+')
);

-- 2. Retire the old bands. Deactivated, never deleted: loadBank filters on
--    active, so this is what actually takes them out of play, while the answer
--    log keeps pointing at readable questions.
UPDATE "quiz_question" SET active = false, update_date = CURRENT_TIMESTAMP
WHERE age_band IN ('3-5', '6-8', '9+') AND active;

UPDATE "riddle_question" SET active = false, update_date = CURRENT_TIMESTAMP
WHERE age_band IN ('3-5', '6-8', '9+') AND active;

-- 3. Tighten the vocabulary to the eight authored ages — for anything SERVABLE.
--
--    Not a plain eight-value CHECK: a constraint covers every row in the table,
--    and step 2 deliberately keeps the retired rows rather than deleting them,
--    so such a constraint could never be satisfied. The invariant that actually
--    matters is narrower and is what this states: a row a child can be served
--    carries a per-age band. Retired rows may keep the name they were authored
--    under, and only that name.
ALTER TABLE "quiz_question" DROP CONSTRAINT IF EXISTS "quiz_question_age_band_check";
ALTER TABLE "quiz_question" ADD CONSTRAINT "quiz_question_age_band_check"
  CHECK (
    "age_band" IN ('3', '4', '5', '6', '7', '8', '9', '10')
    OR (NOT "active" AND "age_band" IN ('3-5', '6-8', '9+'))
  );

ALTER TABLE "riddle_question" DROP CONSTRAINT IF EXISTS "riddle_question_age_band_check";
ALTER TABLE "riddle_question" ADD CONSTRAINT "riddle_question_age_band_check"
  CHECK (
    "age_band" IN ('3', '4', '5', '6', '7', '8', '9', '10')
    OR (NOT "active" AND "age_band" IN ('3-5', '6-8', '9+'))
  );

COMMIT;
