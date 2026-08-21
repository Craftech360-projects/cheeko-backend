// After-session check for one device: what the last session actually recorded.
//
// Run this after each character test instead of hand-writing queries. It answers
// the four questions a test asks: did the persona load, did progress persist,
// did the no-repeat ledger grow, and did the scored banks advance.
//
//   node scripts/character-check.js 68:EE:8F:60:BA:AC
//
// Read-only. Safe to run mid-session.
require('dotenv').config();
const { Client } = require('pg');

const MAC = (process.argv[2] || '68:EE:8F:60:BA:AC').trim();
const ago = (d) => {
  if (!d) return '-';
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
};

(async () => {
  // Strip sslmode: newer pg treats 'require' as verify-full, which rejects the
  // managed provider's chain. Verification is set on the ssl option instead.
  const c = new Client({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/, ''),
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const dev = (await c.query(
    'SELECT mac_address, kid_id FROM ai_device WHERE mac_address ILIKE $1', [MAC]
  )).rows[0];
  if (!dev) {
    console.log(`No ai_device row for ${MAC} — the toy has never bound.`);
    await c.end();
    return;
  }
  const kidId = dev.kid_id;
  console.log(`\nDevice ${dev.mac_address}  child=${kidId ?? 'UNLINKED (rows are device-scoped)'}\n`);

  // Scope exactly as progress.service does, so this reports what the worker reads.
  const scope = kidId ? 'kid_id = $1' : 'device_mac ILIKE $1 AND kid_id IS NULL';
  const arg = kidId ? kidId : MAC;

  const state = (await c.query(
    `SELECT state_type, character, updated_at, left(memo, 90) AS memo
     FROM kid_character_state WHERE ${scope} ORDER BY updated_at DESC`, [arg]
  )).rows;
  console.log('CURRENT STATE (restored into the next session)');
  if (!state.length) console.log('  (none yet — no session has closed)');
  state.forEach((r) => console.log(
    `  ${String(r.state_type).padEnd(13)} ${String(r.character || '?').padEnd(9)} ${ago(r.updated_at).padEnd(8)} ${r.memo}`
  ));

  const sessions = (await c.query(
    `SELECT character, state_type, created_at, data->>'parent_summary' AS summary
     FROM kid_session_progress WHERE ${scope} ORDER BY created_at DESC LIMIT 5`, [arg]
  )).rows;
  console.log('\nRECENT SESSIONS (parent-app feed)');
  if (!sessions.length) console.log('  (none yet)');
  sessions.forEach((r) => console.log(
    `  ${ago(r.created_at).padEnd(8)} ${String(r.character || '?').padEnd(9)} ${String(r.state_type).padEnd(13)} ${r.summary || '(no parent_summary)'}`
  ));

  const seen = (await c.query(
    `SELECT bank, count(*)::int n, max(seen_at) last FROM kid_content_seen
     WHERE ${scope} GROUP BY bank ORDER BY bank`, [arg]
  )).rows;
  console.log('\nCONTENT ALREADY GIVEN (never repeats while unseen items remain)');
  if (!seen.length) console.log('  (none yet)');
  seen.forEach((r) => console.log(`  ${String(r.bank).padEnd(8)} ${String(r.n).padStart(3)} item(s)   last ${ago(r.last)}`));

  console.log('\nSCORED BANKS');
  for (const [bank, qt, at] of [
    ['quiz', 'quiz_question', 'quiz_question_answer'],
    ['riddle', 'riddle_question', 'riddle_question_answer'],
    ['math', 'math_question', 'math_question_answer'],
  ]) {
    const aScope = kidId ? 'a.kid_id = $1' : 'a.device_mac ILIKE $1';
    const rows = (await c.query(
      `SELECT count(*)::int total,
              count(*) FILTER (WHERE a.result = 'correct')::int correct,
              count(*) FILTER (WHERE a.result = 'revealed')::int revealed,
              count(DISTINCT q.level)::int levels,
              max(a.answered_at) last
       FROM ${at} a JOIN ${qt} q ON q.id = a.question_id WHERE ${aScope}`, [arg]
    )).rows[0];
    const today = (await c.query(
      `SELECT count(*)::int n FROM ${at} a WHERE ${aScope} AND a.answered_at >= date_trunc('day', now())`, [arg]
    )).rows[0].n;
    console.log(
      `  ${bank.padEnd(7)} answered ${String(rows.total).padStart(3)}  correct ${String(rows.correct).padStart(3)}`
      + `  revealed ${String(rows.revealed).padStart(2)}  levels touched ${String(rows.levels).padStart(2)}`
      + `  today ${String(today).padStart(2)}/10${today >= 10 ? '  <- DAY COMPLETE' : ''}`
    );
  }
  console.log('');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
