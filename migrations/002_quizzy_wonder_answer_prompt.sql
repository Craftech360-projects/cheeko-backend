-- Quizzy prompt: record what the child ANSWERED to the Wonder Question.
--
-- Content, not schema, so Prisma will never run it: apply by hand to every
-- database, the same way as 001_character_card_art_up.sql.
--
-- Applied to dev DB1 (tsiocygczplmnjpqmutc) 2026-09-02. NOT applied to prod.
--
-- SHIP IT WITH ITS TWO HALVES, in this order:
--   1. prisma migration 20260902000000_wonder_question_answer  (adds answer_text)
--   2. the worker carrying `wonder_answer` (picoclaw b869028)
--   3. this file
-- Out of order it is not dangerous, only inert: an old worker sends no answer,
-- and a prompt asking for one before the column exists writes nowhere.
--
-- WHY: the recall opened with "the question you left them with" even when the
-- child had answered it moments earlier. Prod 2026-09-01: the Daily Ten ended
-- with "if you could build a house out of any food, what would you use?", the
-- child said "Pizza", Quizzy replied about the melted-cheese roof, and the next
-- morning asked the identical question. The child's answer that time was "ask
-- the direct question". Nothing recorded that it had been answered.
--
-- Verified on dev 2026-09-02: "biryani" captured at 06:50, and the session the
-- next morning opened with "I was just thinking about your biryani house, it
-- would be so yummy that I might try to eat the walls".
--
-- Idempotent: the WHERE clause finds the marker and changes nothing on a re-run.
\set ON_ERROR_STOP on
BEGIN;

UPDATE ai_agent_template
SET system_prompt = replace(
  system_prompt,
  'Record it as wonder=YOUR QUESTION in that turn''s MEMO, whether the MEMO says status=completed or status=in_progress.',
  'Record it as wonder=YOUR QUESTION in that turn''s MEMO, whether the MEMO says status=completed or status=in_progress. '
  || 'If the child answers it before they go, add wonder_answer=WHAT THEY SAID to your next MEMO, in their own words and shortened to the idea itself - '
  || '"a house of pizza", not "I think maybe a pizza one". '
  || 'That is how the toy can delight them next time by remembering THEIR answer instead of asking the same question again. '
  || 'Leave wonder_answer out entirely if they did not answer.'
)
WHERE agent_code = 'quiz_master'
  AND position('wonder_answer=' in system_prompt) = 0;

COMMIT;

-- Verify:
--   SELECT position('wonder_answer=' in system_prompt) > 0 FROM ai_agent_template WHERE agent_code = 'quiz_master';
--
-- Revert: restore system_prompt from the backup taken before applying
-- (dev: /root/quizzy_sp_backup_20260831.txt, prod: /root/quizzy_sp_PROD_backup_20260831.txt),
-- or delete the sentence beginning "If the child answers it before they go".
