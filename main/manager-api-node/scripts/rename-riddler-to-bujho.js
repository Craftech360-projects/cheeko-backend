// Rename the riddle character's DISPLAY NAME to Bujho.
//
// install-character-pack.js updates only the three prompt columns on an existing
// row — never agent_name — so an environment seeded before the rename keeps
// "riddler" however many times the pack is installed.
//
// That is not cosmetic. picoclaw's liveKitToollessCharacters matches on
// agent_name and now lists "bujho"; a row still named "riddler" falls through to
// the default for an unknown character, which is to KEEP tools. The character's
// own prompt forbids tool calls, so it gets handed tools it is told never to
// use, silently.
//
//   node scripts/rename-riddler-to-bujho.js            # report only
//   node scripts/rename-riddler-to-bujho.js --apply    # perform the rename
//
// Idempotent: matches on agent_code and only writes when the name is not
// already Bujho. Re-running after a successful rename changes nothing.
require('dotenv').config();
const { Client } = require('pg');

const AGENT_CODE = 'riddle_master';
const NEW_NAME = 'Bujho';
const apply = process.argv.includes('--apply');

(async () => {
  // Prod's connection string carries an sslmode that newer pg treats as
  // verify-full, which rejects Supabase's chain; strip it and verify at the
  // ssl option instead, as the other scripts here do.
  const url = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/, '');
  if (!url) throw new Error('DATABASE_URL is not set');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const rows = (await c.query(
    'SELECT agent_code, agent_name FROM ai_agent_template WHERE agent_code = $1', [AGENT_CODE]
  )).rows;

  if (rows.length === 0) {
    console.log(`No ai_agent_template row for agent_code=${AGENT_CODE}. Nothing to do.`);
    await c.end();
    return;
  }
  if (rows.length > 1) {
    // Refuse rather than guess: agent_code should be unique, and a duplicate
    // means something upstream is wrong that a rename would only paper over.
    console.error(`${rows.length} rows share agent_code=${AGENT_CODE}. Refusing to rename; investigate first.`);
    await c.end();
    process.exit(1);
  }

  const current = rows[0].agent_name;
  if (current === NEW_NAME) {
    console.log(`Already named ${NEW_NAME}. Nothing to do.`);
    await c.end();
    return;
  }

  console.log(`agent_code=${AGENT_CODE}: "${current}" -> "${NEW_NAME}"`);
  if (!apply) {
    console.log('\nReport only. Re-run with --apply to perform the rename.');
    await c.end();
    return;
  }

  // Guard on the name we just read, so a concurrent write loses rather than
  // being silently overwritten.
  const r = await c.query(
    'UPDATE ai_agent_template SET agent_name = $1 WHERE agent_code = $2 AND agent_name = $3',
    [NEW_NAME, AGENT_CODE, current]
  );
  if (r.rowCount !== 1) {
    console.error(`Expected to update 1 row, updated ${r.rowCount}. The row changed underneath; re-run to inspect.`);
    await c.end();
    process.exit(1);
  }

  const after = (await c.query(
    'SELECT agent_name FROM ai_agent_template WHERE agent_code = $1', [AGENT_CODE]
  )).rows[0].agent_name;
  console.log(after === NEW_NAME ? `Renamed. agent_name is now ${after}.` : `FAILED: agent_name is ${after}.`);
  await c.end();
  process.exit(after === NEW_NAME ? 0 : 1);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
