-- teach_text and distractors for both banks (quizzy-redesign 007).
--
-- Ships BEFORE the content re-levelling, not after. The re-levelling sheet
-- carries these columns; if the importer and the tables cannot read them, the
-- sheet fails to load and the authoring work has to be redone.
--
-- Both nullable/defaulted, so every existing sheet keeps importing unchanged and
-- today's 660 rows stay valid without a backfill.
--
-- Added to riddle_question as well, even though Riddler keeps flow rather than
-- mastery (ADR-0009) and has no Door 3 to teach at. The two bank tables are
-- deliberately column-identical — that is what lets one service query either
-- without per-bank field mapping — and letting them drift here would cost more
-- than two unused columns.
ALTER TABLE quiz_question
  ADD COLUMN IF NOT EXISTS teach_text  TEXT,
  ADD COLUMN IF NOT EXISTS distractors JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE riddle_question
  ADD COLUMN IF NOT EXISTS teach_text  TEXT,
  ADD COLUMN IF NOT EXISTS distractors JSONB NOT NULL DEFAULT '[]'::jsonb;
