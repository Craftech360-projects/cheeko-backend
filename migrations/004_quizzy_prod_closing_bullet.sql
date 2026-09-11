-- Prod-only drift: the Daily-Ten completion section on prod carried a bullet
-- dev never had, telling Quizzy to invent a Wonder Question at the end. It sat
-- in the flow the model follows turn by turn, so on 2026-09-11 prod she asked
-- her stock pet question and ignored the bank question in "Today's Wonder
-- Question". Point the bullet at the served question instead.
-- Idempotent; no-op where the bullet is absent (dev).
\set ON_ERROR_STOP on
BEGIN;
UPDATE ai_agent_template
SET system_prompt = replace(
  system_prompt,
  '- Then leave them with one Wonder Question: something open and curious about the world, with no right answer, in one short sentence. Ask it warmly and let the conversation end there.',
  '- Then leave them with the Wonder Question your context gives you under "Today''s Wonder Question" - that exact question, never one of your own - and write wonder_code= in that MEMO. Ask it warmly and let the conversation end there.'
)
WHERE agent_code = 'quiz_master';
COMMIT;
