-- Drop age_band entirely (quizzy-redesign 013).
--
-- ADR-0009 originally kept the column, reasoning that retiring a value is
-- reversible while dropping a column is a migration. That was the cautious call
-- while the value still meant something. It does not: after the collapse every
-- active row carries the identical string, the CHECK constraint guards a
-- constant, and the index leads with a column that never varies. A column that
-- can only hold one value is not a reversibility hedge — it is a field every
-- future reader has to stop and ask about.
--
-- Reversing this is re-adding a nullable column plus a backfill, which is no
-- harder than the collapse itself was.
--
-- The parent-app contract is NOT affected: `age_band` stays in the response as
-- the constant 'all', served from code. Ticket 005 froze that wire deliberately
-- so internal changes stop reaching app developers.
ALTER TABLE quiz_question DROP CONSTRAINT IF EXISTS quiz_question_age_band_check;
ALTER TABLE riddle_question DROP CONSTRAINT IF EXISTS riddle_question_age_band_check;

-- The index led with age_band, so it goes with it. Selection filters on
-- (language, active) and orders by level, which is what the replacement covers.
DROP INDEX IF EXISTS idx_quiz_question_band_lang_level;
DROP INDEX IF EXISTS idx_riddle_question_band_lang_level;

ALTER TABLE quiz_question DROP COLUMN IF EXISTS age_band;
ALTER TABLE riddle_question DROP COLUMN IF EXISTS age_band;

CREATE INDEX IF NOT EXISTS idx_quiz_question_lang_level ON quiz_question (language, level);
CREATE INDEX IF NOT EXISTS idx_riddle_question_lang_level ON riddle_question (language, level);
