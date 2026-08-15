// Copy the quiz/riddle bank + answer log from one database to another.
// Source is SRC_DATABASE_URL, destination is DATABASE_URL (i.e. your .env).
// Scoped to four tables on purpose: users, devices, kids and agent templates
// are NOT touched, so a dev-data refresh cannot clobber local credentials.
//
// ponytail: DELETE + INSERT, no upsert. These are snapshot tables; a refresh
// replaces them. Add ON CONFLICT if you ever need to merge two sources.
require('dotenv').config();
const { Client } = require('pg');

// Parents before children on insert, reverse on delete — question_id is a
// Restrict FK, so answers must go first out and last in.
const TABLES = ['quiz_question', 'quiz_question_answer', 'riddle_question', 'riddle_question_answer'];
const PARENTS = ['quiz_question', 'riddle_question'];

const connect = url => new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  if (!process.env.SRC_DATABASE_URL) throw new Error('SRC_DATABASE_URL not set');
  if (process.env.SRC_DATABASE_URL === process.env.DATABASE_URL) throw new Error('source and destination are the same database');
  if (!process.argv.includes('--yes')) throw new Error('destructive: replaces all rows in ' + TABLES.join(', ') + '. Re-run with --yes');

  const src = connect(process.env.SRC_DATABASE_URL);
  const dst = connect(process.env.DATABASE_URL);
  await src.connect(); await dst.connect();

  const data = {};
  for (const t of TABLES) {
    const { rows } = await src.query(`SELECT * FROM ${t}`);
    data[t] = rows;
    console.log(`read  ${t.padEnd(24)} ${rows.length}`);
  }

  await dst.query('BEGIN');
  try {
    for (const t of [...TABLES].reverse()) await dst.query(`DELETE FROM ${t}`);

    for (const t of TABLES) {
      const rows = data[t];
      if (!rows.length) { console.log(`write ${t.padEnd(24)} 0 (empty)`); continue; }
      const cols = Object.keys(rows[0]);
      const list = cols.map(c => `"${c}"`).join(',');
      const ph = cols.map((_, i) => `$${i + 1}`).join(',');
      for (const r of rows) {
        // json/jsonb columns arrive parsed; hand them back as text.
        const vals = cols.map(c => (r[c] !== null && typeof r[c] === 'object' && !(r[c] instanceof Date)) ? JSON.stringify(r[c]) : r[c]);
        await dst.query(`INSERT INTO ${t} (${list}) VALUES (${ph})`, vals);
      }
      // Ids were copied verbatim, so the identity sequence is now behind the
      // data. Without this the next insert collides on the primary key.
      if (PARENTS.includes(t) || t.endsWith('_answer')) {
        await dst.query(`SELECT setval(pg_get_serial_sequence('${t}','id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`);
      }
      console.log(`write ${t.padEnd(24)} ${rows.length}`);
    }
    await dst.query('COMMIT');
  } catch (e) {
    await dst.query('ROLLBACK');
    throw e;
  }

  for (const t of TABLES) {
    const { rows } = await dst.query(`SELECT count(*)::int n FROM ${t}`);
    console.log(`verify ${t.padEnd(24)} ${rows[0].n}`);
  }
  await src.end(); await dst.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
