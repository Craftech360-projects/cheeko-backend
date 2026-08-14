// Issue 002 — revealed blast radius. READ ONLY. No UPDATE, no DELETE.
// Mirrors deriveLevelState in quiz.logic.js: current level = lowest level
// holding any uncleared question. Cleared set is the only thing that changes.
require('dotenv').config();
const { Client } = require('pg');

const BANKS = [
  { name: 'quiz',   q: 'quiz_question',   a: 'quiz_question_answer' },
  { name: 'riddle', q: 'riddle_question', a: 'riddle_question_answer' },
];

// deriveLevelState, minus the parts that don't affect the level number.
// allCleared -> maxLevel + 1, so "finished the bank" sorts above every level.
const currentLevel = (questions, cleared, maxLevel) => {
  const levels = [...new Set(questions.map(q => q.level))].sort((a, b) => a - b);
  for (const lv of levels) {
    if (questions.some(q => q.level === lv && !cleared.has(q.id))) return lv;
  }
  return maxLevel + 1;
};

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  for (const bank of BANKS) {
    console.log(`\n${'='.repeat(70)}\n${bank.name.toUpperCase()}\n${'='.repeat(70)}`);

    const { rows: qs } = await c.query(
      `SELECT id::text, level, age_band, language FROM ${bank.q} WHERE active = true`);
    if (!qs.length) { console.log('empty bank — nothing to measure'); continue; }

    // Verdict spread. Issue 001: the live prompt emits only correct|revealed,
    // so any `wrong` row here was written by something other than that prompt.
    const { rows: spread } = await c.query(
      `SELECT result, count(*)::int AS n FROM ${bank.a} GROUP BY result ORDER BY n DESC`);
    console.log('\nverdicts:'); console.table(spread);

    // MAC case: the dev DB holds both 00:16:3E:.. and 00:16:3e:.. for one device.
    // A case-sensitive grouping splits one child in two and understates the pullback.
    const { rows: ans } = await c.query(
      `SELECT lower(device_mac) AS mac, question_id::text AS qid, result FROM ${bank.a}`);
    const { rows: macCase } = await c.query(
      `SELECT count(DISTINCT device_mac)::int AS raw, count(DISTINCT lower(device_mac))::int AS folded FROM ${bank.a}`);
    console.log(`macs: ${macCase[0].raw} raw, ${macCase[0].folded} case-folded`);

    const qById = new Map(qs.map(q => [q.id, q]));
    const byDevice = new Map();
    for (const r of ans) {
      if (!byDevice.has(r.mac)) byDevice.set(r.mac, []);
      byDevice.get(r.mac).push(r);
    }

    const report = [];
    let revealedOnly = 0;
    for (const [mac, rows] of byDevice) {
      // Bank slice this device plays: the band/language of the questions it answered.
      const bands = new Set(rows.map(r => qById.get(r.qid)).filter(Boolean)
        .map(q => `${q.age_band}|${q.language}`));
      for (const band of bands) {
        const [age_band, language] = band.split('|');
        const slice = qs.filter(q => q.age_band === age_band && q.language === language);
        const maxLevel = Math.max(...slice.map(q => q.level));
        const mine = rows.filter(r => { const q = qById.get(r.qid); return q && q.age_band === age_band && q.language === language; });

        const before = new Set(mine.filter(r => ['correct', 'revealed'].includes(r.result)).map(r => r.qid));
        const after = new Set(mine.filter(r => r.result === 'correct').map(r => r.qid));
        const reopened = [...before].filter(q => !after.has(q));
        revealedOnly += reopened.length;

        const lvBefore = currentLevel(slice, before, maxLevel);
        const lvAfter = currentLevel(slice, after, maxLevel);
        if (lvBefore !== lvAfter || reopened.length) {
          report.push({ mac: mac.slice(-8), band: age_band, lang: language,
            lvBefore, lvAfter, pullback: lvBefore - lvAfter, reopened: reopened.length });
        }
      }
    }

    report.sort((a, b) => b.pullback - a.pullback);
    console.log(`\nrevealed-only questions that reopen: ${revealedOnly}`);
    console.log(`devices affected: ${report.length} of ${byDevice.size}`);
    if (report.length) {
      console.table(report.slice(0, 25));
      const pb = report.map(r => r.pullback).sort((a, b) => a - b);
      const median = pb[Math.floor(pb.length / 2)];
      console.log(`pullback — worst: ${pb[pb.length - 1]} levels, median: ${median} levels`);
    }
  }
  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
