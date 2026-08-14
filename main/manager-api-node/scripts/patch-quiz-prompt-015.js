#!/usr/bin/env node
/**
 * Ticket 015: teach the prompt to ask a Wonder Question and report it.
 *
 *   node scripts/dump-agent-prompt.js /tmp/p015          # backup first
 *   node scripts/patch-quiz-prompt-015.js /tmp/p015/quiz_master.system_prompt.txt
 *   node scripts/patch-quiz-prompt-015.js /tmp/p015/quiz_master.system_prompt.txt --apply
 *
 * Dry-run by default. Two edits, both additive:
 *
 *  1. The closing beat — one open question with no right answer, after the score
 *     is announced. It is the only question Quizzy may invent besides Bonus Buzz,
 *     and it is deliberately NOT a quiz question: no judging, no scoring, no
 *     correction. The child's answer is not the point; being asked is.
 *
 *  2. `wonder=` on the completion MEMO, which is how the worker gets it. Without
 *     this the plumbing built in 015 stays inert — the table, the endpoint and
 *     the recall are all in place and nothing ever fills them.
 *
 * The UPDATE is guarded on the exact prior text, so a prompt that changed since
 * the backup updates nothing rather than clobbering someone else's edit.
 */
require('dotenv/config');
const fs = require('fs');
const { Client } = require('pg');

const EDITS = [
  {
    what: 'the closing Wonder Question beat',
    find: `- Never shame them for missed questions.`,
    replace: `- Never shame them for missed questions.
- Then leave them with one Wonder Question: something open and curious about the world, with no right answer, in one short sentence. Ask it warmly and let the conversation end there.

The Wonder Question is not a quiz question. Do NOT judge it, score it, correct it, or tell the child the answer — there isn't one. If they answer, be delighted and curious back. If they don't, that is equally fine. It never affects the Daily Ten.`,
  },
  {
    what: 'the wonder= MEMO field',
    find: `MEMO: type=daily_quiz | date=YYYY-MM-DD | status=completed | answered=10 | first_try=N | with_hint=N | missed=N | scored_q=JUDGED_QUESTION_ID | scored_text=THE QUESTION YOU JUST JUDGED | result=correct|revealed | strengths=TOPICS | practice=TOPICS | parent_summary=SHORT_SUMMARY`,
    replace: `MEMO: type=daily_quiz | date=YYYY-MM-DD | status=completed | answered=10 | first_try=N | with_hint=N | missed=N | scored_q=JUDGED_QUESTION_ID | scored_text=THE QUESTION YOU JUST JUDGED | result=correct|revealed | strengths=TOPICS | practice=TOPICS | wonder=THE WONDER QUESTION YOU ASKED | parent_summary=SHORT_SUMMARY

Set “wonder” to the Wonder Question exactly as you asked it. It is how the toy remembers what this child was left wondering about, so it can open with it next time. Omit it only if you did not ask one.`,
  },
];

(async () => {
  const backup = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!backup) throw new Error('usage: patch-quiz-prompt-015.js <backup-of-system_prompt.txt> [--apply]');

  const before = fs.readFileSync(backup, 'utf8');
  let after = before;

  for (const edit of EDITS) {
    if (after.includes(edit.replace)) throw new Error(`already applied: ${edit.what}`);
    if (!after.includes(edit.find)) {
      throw new Error(`anchor not found for ${edit.what} — the prompt has changed, re-dump and re-read before editing`);
    }
    after = after.replace(edit.find, edit.replace);
    console.log(`\n--- ${edit.what}\n${edit.replace}`);
  }

  console.log(`\nlength ${before.length} -> ${after.length}`);
  if (!apply) return console.log('\nDRY RUN — pass --apply to write');

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rowCount } = await c.query(
    'UPDATE ai_agent_template SET system_prompt = $1 WHERE agent_code = $2 AND system_prompt = $3',
    [after, 'quiz_master', before]);
  console.log(rowCount === 1 ? 'APPLIED (1 row)' : `NOT APPLIED (${rowCount} rows) — prompt changed since the backup`);
  await c.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
