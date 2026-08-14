// Issue 001 — dump the quiz_master / riddler prompts. READ ONLY.
// ponytail: no CLI args, no config; the two agent_codes are the whole job.
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

const OUT = process.argv[2] || '.';
// The trap from ticket 006: the row is 'quiz_master', NOT 'quizzy'.
const CODES = ['quiz_master', 'riddler'];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const ident = await c.query(
    `SELECT agent_code, agent_name, length(system_prompt) AS sys_len, length(greeting_prompt) AS greet_len
     FROM ai_agent_template WHERE agent_code = ANY($1) ORDER BY agent_code`, [CODES]);
  console.table(ident.rows);

  if (ident.rows.length === 0) {
    console.error('FAIL: zero rows. Check agent_code values before doing anything else.');
    // Show what codes DO exist, so a wrong guess is visible instead of silent.
    const all = await c.query('SELECT agent_code, agent_name FROM ai_agent_template ORDER BY agent_code');
    console.table(all.rows);
    await c.end();
    process.exit(1);
  }

  const full = await c.query(
    `SELECT agent_code, agent_name, system_prompt, greeting_prompt
     FROM ai_agent_template WHERE agent_code = ANY($1)`, [CODES]);

  for (const r of full.rows) {
    for (const field of ['system_prompt', 'greeting_prompt']) {
      const file = path.join(OUT, `${r.agent_code}.${field}.txt`);
      fs.writeFileSync(file, r[field] ?? '');
      const size = fs.statSync(file).size;
      // AC: backup confirmed non-empty before proceeding. system_prompt empty = stop.
      console.log(`${size === 0 ? 'EMPTY  ' : 'ok     '} ${file}  ${size} bytes`);
      if (size === 0 && field === 'system_prompt') process.exitCode = 1;
    }
  }
  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
