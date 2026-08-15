// Ticket 008: one line in quiz_master.system_prompt. Backup taken first; the
// diff is printed and the UPDATE only runs with --apply.
require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');

const OLD = 'The runtime guarantees the child has not already cleared the questions it gives you, so you never need to check memory for repeats.';
const NEW = 'The runtime decides which questions to give you and never repeats one the child has already mastered, so you never need to check memory for repeats. A question the child did not solve WILL come back on a later day — that is deliberate, not an error. If the child says they have seen it before, agree warmly and let them try again.';

(async () => {
  const backup = process.argv[2];
  const apply = process.argv.includes('--apply');
  const before = fs.readFileSync(backup, 'utf8');
  if (!before.includes(OLD)) throw new Error('target line not found — prompt has changed, re-read before editing');
  if (before.includes(NEW)) throw new Error('already applied');

  const after = before.replace(OLD, NEW);
  console.log('--- before\n' + OLD + '\n\n+++ after\n' + NEW + '\n');
  console.log(`length ${before.length} -> ${after.length}`);
  if (!apply) return console.log('\nDRY RUN — pass --apply to write');

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rowCount } = await c.query(
    'UPDATE ai_agent_template SET system_prompt = $1 WHERE agent_code = $2 AND system_prompt = $3',
    [after, 'quiz_master', before]);
  // Guarded on the exact prior text: if the row changed since the backup, this
  // updates nothing rather than clobbering someone else's edit.
  console.log(rowCount === 1 ? 'APPLIED (1 row)' : `NOT APPLIED (${rowCount} rows) — prompt changed since backup`);
  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
