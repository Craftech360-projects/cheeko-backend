-- Per-age question banks, step 1 of 3: EXPAND.
--
-- Replaces the three Age Bands ('3-5','6-8','9+') with one bank per age, 3..10.
-- Design: picoclaw docs/issues/per-age-banks/000-design.md, issue 001.
--
-- This step is additive and changes NO behaviour: the old band rows stay
-- active, and nothing queries the new ones until the manager-api deploy in
-- issue 002 flips ageBandFromBirthDate. Retiring the old rows here would be a
-- live outage — loadBank filters on active, so children would find zero
-- questions between this SQL and that deploy. Retirement is issue 005.
--
-- Re-runnable end to end: the clone is guarded by the unique code index and the
-- remap by NOT EXISTS. Replay it immediately before the 002 deploy to pick up
-- anything answered in between.

BEGIN;

-- 1. Widen the vocabulary so both the old bands and the new ages are legal.
--    Tightened to the eight ages alone in issue 005.
ALTER TABLE "quiz_question" DROP CONSTRAINT IF EXISTS "quiz_question_age_band_check";
ALTER TABLE "quiz_question" ADD CONSTRAINT "quiz_question_age_band_check"
  CHECK ("age_band" IN ('3-5', '6-8', '9+', '3', '4', '5', '6', '7', '8', '9', '10'));

ALTER TABLE "riddle_question" DROP CONSTRAINT IF EXISTS "riddle_question_age_band_check";
ALTER TABLE "riddle_question" ADD CONSTRAINT "riddle_question_age_band_check"
  CHECK ("age_band" IN ('3-5', '6-8', '9+', '3', '4', '5', '6', '7', '8', '9', '10'));

-- 2. Clone every band row into each of its constituent ages. The `-a<age>` code
--    suffix keeps the parent traceable and is what the remap below joins on.
--    Authored per-age content later upserts over these same codes, so replacing
--    a clone causes no id churn and no progress loss.
INSERT INTO "quiz_question"
  (code, question_text, answer_text, accepted_answers, category, age_band, level, language, active)
SELECT q.code || '-a' || a.age, q.question_text, q.answer_text, q.accepted_answers,
       q.category, a.age::text, q.level, q.language, q.active
FROM "quiz_question" q
JOIN LATERAL (
  SELECT unnest(CASE q.age_band
    WHEN '3-5' THEN ARRAY[3, 4, 5]
    WHEN '6-8' THEN ARRAY[6, 7, 8]
    WHEN '9+'  THEN ARRAY[9, 10]
  END) AS age
) a ON true
WHERE q.age_band IN ('3-5', '6-8', '9+')
ON CONFLICT (code) DO NOTHING;

INSERT INTO "riddle_question"
  (code, question_text, answer_text, accepted_answers, category, age_band, level, language, active)
SELECT q.code || '-a' || a.age, q.question_text, q.answer_text, q.accepted_answers,
       q.category, a.age::text, q.level, q.language, q.active
FROM "riddle_question" q
JOIN LATERAL (
  SELECT unnest(CASE q.age_band
    WHEN '3-5' THEN ARRAY[3, 4, 5]
    WHEN '6-8' THEN ARRAY[6, 7, 8]
    WHEN '9+'  THEN ARRAY[9, 10]
  END) AS age
) a ON true
WHERE q.age_band IN ('3-5', '6-8', '9+')
ON CONFLICT (code) DO NOTHING;

-- 3. Carry each device's progress onto the clones in ITS OWN age bank. Without
--    this every child restarts at level 1 and re-hears questions they cleared.
--
--    The age arithmetic mirrors ageBandFromBirthDate: completed years, read in
--    UTC (birth_date is a DATE that Prisma returns as UTC midnight), clamped to
--    3..10, defaulting to 6 when there is no device row, no kid, or no birth
--    date — the same fallback the service applies.
--
--    device_mac is matched case-insensitively (one device appears under two
--    casings in the log, and macFilter reads case-insensitively) but copied
--    verbatim, so the remapped row reads exactly like the row it came from.
INSERT INTO "quiz_question_answer" (device_mac, question_id, result, answered_at)
SELECT a.device_mac, clone.id, a.result, a.answered_at
FROM "quiz_question_answer" a
JOIN "quiz_question" old
  ON old.id = a.question_id AND old.age_band IN ('3-5', '6-8', '9+')
LEFT JOIN "ai_device" d ON lower(d.mac_address) = lower(a.device_mac)
LEFT JOIN "kid_profile" k ON k.id = d.kid_id
JOIN "quiz_question" clone
  ON clone.code = old.code || '-a' || COALESCE(
       greatest(3, least(10, date_part('year', age((now() AT TIME ZONE 'UTC')::date, k.birth_date))::int)),
       6
     )::text
WHERE NOT EXISTS (
  SELECT 1 FROM "quiz_question_answer" dup
  WHERE dup.device_mac = a.device_mac
    AND dup.question_id = clone.id
    AND dup.answered_at = a.answered_at
);

INSERT INTO "riddle_question_answer" (device_mac, question_id, result, answered_at)
SELECT a.device_mac, clone.id, a.result, a.answered_at
FROM "riddle_question_answer" a
JOIN "riddle_question" old
  ON old.id = a.question_id AND old.age_band IN ('3-5', '6-8', '9+')
LEFT JOIN "ai_device" d ON lower(d.mac_address) = lower(a.device_mac)
LEFT JOIN "kid_profile" k ON k.id = d.kid_id
JOIN "riddle_question" clone
  ON clone.code = old.code || '-a' || COALESCE(
       greatest(3, least(10, date_part('year', age((now() AT TIME ZONE 'UTC')::date, k.birth_date))::int)),
       6
     )::text
WHERE NOT EXISTS (
  SELECT 1 FROM "riddle_question_answer" dup
  WHERE dup.device_mac = a.device_mac
    AND dup.question_id = clone.id
    AND dup.answered_at = a.answered_at
);

COMMIT;
