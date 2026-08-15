#!/usr/bin/env node
/**
 * Revert the wonder-repeat prompt patch.
 *
 *   node scripts/revert-quiz-prompt-wonder-repeat.js /tmp/pwonder/quiz_master.system_prompt.txt
 *   node scripts/revert-quiz-prompt-wonder-repeat.js /tmp/pwonder/quiz_master.system_prompt.txt --apply
 *
 * The patch was applied on a diagnosis the worker logs later disproved. Every
 * completed session had produced a distinct Wonder Question; the duplicates came
 * from a new session restating the previous session's restored MEMO, which is
 * fixed in the worker instead. The prompt text was not wrong, it was answering a
 * question nobody had asked — 572 characters on a cached prompt for nothing.
 *
 * Recomputes the patched text from the backup rather than trusting what is in
 * the database, and guards the UPDATE on it. A prompt edited since the patch
 * therefore reverts nothing rather than losing the other edit.
 */
require('dotenv/config');
const fs = require('fs');
const { Client } = require('pg');

const EDITS = [
  {
    find: `The Wonder Question is not a quiz question. Do NOT judge it, score it, correct it, or tell the child the answer — there isn't one. If they answer, be delighted and curious back. If they don't, that is equally fine. It never affects the Daily Ten.`,
    replace: `The Wonder Question is not a quiz question. Do NOT judge it, score it, correct it, or tell the child the answer — there isn't one. If they answer, be delighted and curious back. If they don't, that is equally fine. It never affects the Daily Ten.

If you opened today by remembering what the child wondered about last time, today's Wonder Question must be about something DIFFERENT — a different creature, place, feeling or everyday thing. Do not repeat or reword the remembered one. You are showing them there is always something new to be curious about, and asking the same thing every day shows them the opposite.`,
  },
  {
    find: `- Never guess an id, and never write a scored_text for a question that is not in the supplied list. Copy both from the list.`,
    replace: `- Never guess an id, and never write a scored_text for a question that is not in the supplied list. Copy both from the list.
- When you write “wonder=”, it must be today's new Wonder Question, not the one you were reminded of at the start of this session. If it would be the same, choose a different subject before you ask it.`,
  },
];

(async () => {
  const backup = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!backup) throw new Error('usage: revert-quiz-prompt-wonder-repeat.js <pre-patch-backup.txt> [--apply]');

  const before = fs.readFileSync(backup, 'utf8');
  let patched = before;
  for (const edit of EDITS) {
    if (!patched.includes(edit.find)) throw new Error('anchor not found — this backup is not the one the patch was built from');
    patched = patched.replace(edit.find, edit.replace);
  }

  console.log(`restoring ${patched.length} -> ${before.length} chars`);
  if (!apply) return console.log('DRY RUN — pass --apply to write');

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rowCount } = await c.query(
    'UPDATE ai_agent_template SET system_prompt = $1 WHERE agent_code = $2 AND system_prompt = $3',
    [before, 'quiz_master', patched]);
  console.log(rowCount === 1 ? 'REVERTED (1 row)' : `NOT REVERTED (${rowCount} rows) — the live prompt is not the patched text`);
  await c.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
