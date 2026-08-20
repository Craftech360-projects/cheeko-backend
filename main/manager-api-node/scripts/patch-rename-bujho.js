// Rename the riddle character's DISPLAY name from "riddler" to "Bujho".
//
// agent_code stays `riddle_master`: it is the join key banks.js uses to pick
// the riddle bank, and an unrecognised code falls back to the QUIZ bank
// silently (bankFor's `|| DEFAULT_BANK`), so a half-done rename would serve
// Quizzy's questions through the riddle prompt with no error anywhere.
//
// The prompts move with the name in the same transaction. Changing only
// agent_name would leave the toy introducing itself as Riddler while the
// dashboard, the parent app and every analytics row said Bujho — worse than
// the inconsistency being fixed.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const CODE = 'riddle_master';
const NEW_NAME = 'Bujho';

// Word-boundary and case-insensitive: "Riddler" in prose, "riddler" as a name.
// Deliberately NOT touching "riddle"/"riddles" — those are the content, not the
// character, and blanket-replacing them would rename the game itself.
const RIDDLER_RE = /\bRiddler\b/gi;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const row = (await c.query(
    'SELECT agent_name, system_prompt, greeting_prompt, soul FROM ai_agent_template WHERE agent_code = $1', [CODE]
  )).rows[0];
  if (!row) { console.error('no row for agent_code', CODE); process.exit(1); }

  const next = {
    agent_name: NEW_NAME,
    system_prompt: row.system_prompt.replace(RIDDLER_RE, NEW_NAME),
    greeting_prompt: row.greeting_prompt.replace(RIDDLER_RE, NEW_NAME),
    soul: (row.soul || '').replace(RIDDLER_RE, NEW_NAME),
  };

  console.log('agent_name:', row.agent_name, '->', next.agent_name);
  for (const f of ['system_prompt', 'greeting_prompt', 'soul']) {
    const hits = (String(row[f] || '').match(RIDDLER_RE) || []).length;
    console.log(`${f.padEnd(16)} ${hits} mention(s) replaced`);
  }
  // Anything still naming the old character after the rewrite.
  const leftover = Object.values(next).join('\n').match(RIDDLER_RE);
  if (leftover) console.log('WARNING leftover mentions:', leftover.length);

  if (!APPLY) { console.log('\nDRY RUN — rerun with --apply'); await c.end(); return; }
  const res = await c.query(
    `UPDATE ai_agent_template
     SET agent_name = $1, system_prompt = $2, greeting_prompt = $3, soul = $4, updated_at = now()
     WHERE agent_code = $5 AND agent_name = $6 AND system_prompt = $7 AND greeting_prompt = $8`,
    [next.agent_name, next.system_prompt, next.greeting_prompt, next.soul,
     CODE, row.agent_name, row.system_prompt, row.greeting_prompt]
  );
  console.log(res.rowCount === 1 ? 'UPDATED' : 'GUARD FAILED — row changed under us');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
