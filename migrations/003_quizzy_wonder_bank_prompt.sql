-- Quizzy prompt: the Wonder Question comes from the bank, not from her.
--
-- Content, not schema: apply by hand to every database, like 001 and 002.
-- Ship AFTER prisma migration 20260911000000_wonder_bank and the worker that
-- carries wonder_to_ask. Out of order it is inert, not dangerous: without the
-- block in context she simply has no question named, and the old fallback
-- (invent one against the list) still runs.
--
-- Applied to dev DB1 2026-09-11. NOT applied to prod.
--
-- WHY: on 2026-09-11 prod re-asked the 2026-09-01 food-house question with one
-- word changed, the day after it fell off the five-item do-not-repeat list.
-- Every guard was a text comparison of the model's own choice. The server now
-- chooses from wonder_bank against the child's whole kid_content_seen ledger,
-- and the prompt's job shrinks to: ask the one you were given, record its code.
--
-- Idempotent: the WHERE finds the marker and changes nothing on a re-run.
\set ON_ERROR_STOP on
BEGIN;

UPDATE ai_agent_template
SET system_prompt = replace(
  system_prompt,
  'When the session ends - after Question Ten, or when the child says bye partway through - leave them with ONE Wonder Question: a short, open question with no right answer, about anything at all. "If you could build a house out of any food, what would you use?" is one. Ask it warmly, be delighted by whatever they say, and let them go. It is never scored and never counts towards the Daily Ten.

It must be a NEW question. If your context opened this session by asking you to remember a question the child was left with, that one is spent - leave a different one, about something else.

Record it as wonder=YOUR QUESTION in that turn''s MEMO, whether the MEMO says status=completed or status=in_progress.',
  'When the session ends - after Question Ten, or when the child says bye partway through - leave them with the Wonder Question your context gives you under "Today''s Wonder Question". Ask THAT question, in your own warm words but the same question, and never one of your own: it was chosen for this child because they have not heard it, and inventing a different one is how a child gets asked the same thing twice. Be delighted by whatever they say, and let them go. It is never scored and never counts towards the Daily Ten. If your context has no "Today''s Wonder Question" section, leave them a short open question of your own that is not on the "Already Wondered" list.

Record it in that turn''s MEMO as wonder_code=THE CODE shown next to the question and wonder=THE QUESTION as you asked it, whether the MEMO says status=completed or status=in_progress.'
)
WHERE agent_code = 'quiz_master'
  AND position('wonder_code=' in system_prompt) = 0;

COMMIT;

-- Verify:
--   SELECT position('wonder_code=' in system_prompt) > 0 FROM ai_agent_template WHERE agent_code = 'quiz_master';
