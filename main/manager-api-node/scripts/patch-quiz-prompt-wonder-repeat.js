#!/usr/bin/env node
/**
 * The Wonder Question must not echo the one it just recalled.
 *
 *   node scripts/dump-agent-prompt.js /tmp/pwonder
 *   node scripts/patch-quiz-prompt-wonder-repeat.js /tmp/pwonder/quiz_master.system_prompt.txt
 *   node scripts/patch-quiz-prompt-wonder-repeat.js /tmp/pwonder/quiz_master.system_prompt.txt --apply
 *
 * M4 feeds itself. The stored Wonder Question is rendered as the NEXT session's
 * opening beat, so it is sitting in context when the model is asked to produce a
 * new one at the end of that same session — and a 31B model reaches for the
 * nearest thing it can see. Observed on dev 2026-08-15: the same bee question
 * was stored twice byte-for-byte, and the child heard it at both ends of every
 * session. Once it lands on one it is a fixed point.
 *
 * Nothing in the prompt said the new one had to be different, and everything in
 * context suggested it should be the same. This says it, at the only two places
 * the model is looking: where it is told to ask one, and where it is told to
 * report it.
 *
 * Server-side there is a matching backstop — recordWonderQuestion refuses a
 * question identical to the previous one — so a model that ignores this does not
 * quietly re-pin the loop.
 *
 * Additive: an older worker is unaffected. Dry-run by default, and the UPDATE is
 * guarded on the exact prior text so a prompt that moved since the backup
 * updates nothing rather than clobbering another edit.
 */
require('dotenv/config');
const fs = require('fs');
const { Client } = require('pg');

const EDITS = [
  {
    what: 'the closing Wonder Question must be about something new',
    find: `The Wonder Question is not a quiz question. Do NOT judge it, score it, correct it, or tell the child the answer — there isn't one. If they answer, be delighted and curious back. If they don't, that is equally fine. It never affects the Daily Ten.`,
    replace: `The Wonder Question is not a quiz question. Do NOT judge it, score it, correct it, or tell the child the answer — there isn't one. If they answer, be delighted and curious back. If they don't, that is equally fine. It never affects the Daily Ten.

If you opened today by remembering what the child wondered about last time, today's Wonder Question must be about something DIFFERENT — a different creature, place, feeling or everyday thing. Do not repeat or reword the remembered one. You are showing them there is always something new to be curious about, and asking the same thing every day shows them the opposite.`,
  },
  {
    what: 'say it again where the field is reported',
    find: `- Never guess an id, and never write a scored_text for a question that is not in the supplied list. Copy both from the list.`,
    replace: `- Never guess an id, and never write a scored_text for a question that is not in the supplied list. Copy both from the list.
- When you write “wonder=”, it must be today's new Wonder Question, not the one you were reminded of at the start of this session. If it would be the same, choose a different subject before you ask it.`,
  },
];

(async () => {
  const backup = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!backup) throw new Error('usage: patch-quiz-prompt-wonder-repeat.js <backup-of-system_prompt.txt> [--apply]');

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
