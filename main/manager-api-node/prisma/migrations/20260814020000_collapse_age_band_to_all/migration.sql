-- Collapse the eight per-age banks into one (ADR-0009, quizzy-redesign 013).
--
-- Age is a poor proxy for ability and eight banks was an unfundable authoring
-- load. The range is carried by the Doors instead — the same question asked
-- plainly, then narrowed, then guided.
--
-- The VALUE is retired, not the column: ageBandFromBirthDate still exists, the
-- column stays, and the (age_band, language, level) index is untouched. Retiring
-- a value is reversible; dropping a column is a migration.
--
-- Inactive rows are left alone deliberately. They are retired content nobody is
-- served, and rewriting them would destroy the record of which bank they were
-- authored for.
-- The CHECK constraint moves with the data. It exists to stop content landing in
-- a bank nothing is served from, which is exactly what an active per-age row
-- becomes after this collapse — so ACTIVE rows must now be 'all', while inactive
-- rows keep every historical value including the retired '3-5'/'6-8'/'9+'.
ALTER TABLE quiz_question DROP CONSTRAINT IF EXISTS quiz_question_age_band_check;
ALTER TABLE riddle_question DROP CONSTRAINT IF EXISTS riddle_question_age_band_check;

UPDATE quiz_question SET age_band = 'all', update_date = now() WHERE active = true AND age_band <> 'all';

-- Riddler collapses too. Its bank is column-identical by design and it plays the
-- same game against different content, so leaving it per-age would mean the two
-- characters silently disagree about what a band means.
UPDATE riddle_question SET age_band = 'all', update_date = now() WHERE active = true AND age_band <> 'all';

ALTER TABLE quiz_question ADD CONSTRAINT quiz_question_age_band_check CHECK (
  age_band = 'all'
  OR (NOT active AND age_band IN ('3','4','5','6','7','8','9','10','3-5','6-8','9+'))
);
ALTER TABLE riddle_question ADD CONSTRAINT riddle_question_age_band_check CHECK (
  age_band = 'all'
  OR (NOT active AND age_band IN ('3','4','5','6','7','8','9','10','3-5','6-8','9+'))
);

-- kid_learning_progress is NOT rewritten.
--
-- It is unique on (kid_id, subject, topic) where topic reads "<band> level <n>",
-- so the collapse means new achievements land under "all level 3" while older
-- ones stay under "7 level 3". A child's history therefore shows a seam at this
-- cutover date.
--
-- Accepted rather than migrated, deliberately: those rows record something a
-- child actually earned, under the rules that applied at the time. Rewriting the
-- topic strings would restate history to match a decision made afterwards, and
-- the same instinct is why the answer log is never rewritten either. The seam is
-- explainable ("we changed how levels are organised on this date"); silently
-- edited achievements are not.
--
-- Cutover date: 2026-08-14.
