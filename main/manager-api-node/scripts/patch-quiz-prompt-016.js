#!/usr/bin/env node
/**
 * Ticket 016: make the model report UNCLEAR turns.
 *
 *   node scripts/dump-agent-prompt.js /tmp/p016
 *   node scripts/patch-quiz-prompt-016.js /tmp/p016/quiz_master.system_prompt.txt
 *   node scripts/patch-quiz-prompt-016.js /tmp/p016/quiz_master.system_prompt.txt --apply
 *
 * The prompt has always classified UNCLEAR and never reported it, so the worker
 * was left inferring: any child utterance while the same question stayed pending
 * counted as a wrong try. "Can you repeat the question?" was logged as a miss in
 * a live session, and two misses trip the reveal — so a child who simply did not
 * hear would be handed the answer they never got to try for.
 *
 * A phrase list stood in for this and has been deleted. It matched substrings
 * with no understanding; the model is the only participant that can tell "I do
 * not know" from "say that again", because only it heard the child.
 *
 * Additive: an older worker ignores the new field. Dry-run by default, and the
 * UPDATE is guarded on the exact prior text.
 */
require('dotenv/config');
const fs = require('fs');
const { Client } = require('pg');

const EDITS = [
  {
    what: 'report UNCLEAR in the MEMO',
    find: `- Omit “scored_q”, “scored_text” and “result” on turns where you did not finish judging a question.`,
    replace: `- Omit “scored_q”, “scored_text” and “result” on turns where you did not finish judging a question.
- Add “unclear=yes” on any turn you judged UNCLEAR — you could not make out what the child said, or they asked you to repeat the question rather than answering it. This is how the toy knows not to count that turn as a wrong try. A child who could not hear you must never be moved closer to being told the answer. If they did attempt an answer, even a very wrong one, do NOT set it.`,
  },
  {
    what: 'name the MEMO field where UNCLEAR is handled',
    find: `For unclear speech:

- Ask the child to repeat once.
- If it is still unclear, turn the question into an either/or choice.
- Do not change the score or question number.`,
    replace: `For unclear speech:

- Ask the child to repeat once.
- If it is still unclear, turn the question into an either/or choice.
- Do not change the score or question number.
- Set “unclear=yes” in this turn's MEMO (see the memory section). Asking to hear the question again counts as unclear, not as a wrong answer.`,
  },
];

(async () => {
  const backup = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!backup) throw new Error('usage: patch-quiz-prompt-016.js <backup-of-system_prompt.txt> [--apply]');

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
