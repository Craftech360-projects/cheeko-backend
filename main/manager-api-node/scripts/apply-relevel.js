#!/usr/bin/env node
/**
 * Apply the 24-levels-of-10 re-levelling (ticket 014, quiz bank).
 *
 *   node scripts/apply-relevel.js            # dry run
 *   node scripts/apply-relevel.js --apply
 *
 * The order is not invented: every `code` still carries the authoring
 * provenance the dropped age_band column held — band, original level within
 * that band, and the per-age variant. Sorting by it re-expresses the original
 * authors' own difficulty judgement as one ladder.
 *
 * Idempotent: re-running produces the same assignment from the same codes.
 */
require('dotenv/config');
const { prisma, pgPool } = require('../src/config/database');

const PER_LEVEL = 10;
const BAND = { '3-5': 0, '6-8': 1, '9+': 2, '9': 2 };
const provenance = (code) => {
  const m = /^(\d+(?:-\d+)?|\d\+)-L(\d+)-Q(\d+)(?:-a(\d+))?/i.exec(code);
  return m
    ? { rank: BAND[m[1]] ?? 98, level: +m[2], q: +m[3], age: m[4] ? +m[4] : 0 }
    : { rank: 99, level: 99, q: 99, age: 99 };
};

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = await prisma.quiz_question.findMany({
    where: { active: true }, select: { id: true, code: true, level: true },
  });

  const ordered = rows
    .map((r) => ({ r, p: provenance(r.code) }))
    .sort((a, b) => a.p.rank - b.p.rank || a.p.level - b.p.level || a.p.age - b.p.age
      || a.p.q - b.p.q || a.r.code.localeCompare(b.r.code));

  let moved = 0;
  for (const [i, { r }] of ordered.entries()) {
    const level = Math.floor(i / PER_LEVEL) + 1;
    if (r.level === level) continue;
    moved += 1;
    if (apply) {
      await prisma.quiz_question.update({ where: { id: r.id }, data: { level, update_date: new Date() } });
    }
  }

  console.log(`${apply ? '' : '[dry-run] '}${ordered.length} questions -> ${Math.ceil(ordered.length / PER_LEVEL)} levels of ${PER_LEVEL}; ${moved} rows change level`);
  if (apply) {
    const counts = await prisma.$queryRaw`SELECT level, count(*)::int n FROM quiz_question WHERE active = true GROUP BY level ORDER BY level`;
    const bad = counts.filter((c) => Number(c.n) !== PER_LEVEL);
    console.log(`levels: ${counts.length}, wrong size: ${bad.length ? JSON.stringify(bad) : 'none'}`);
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect().catch(() => {}); if (pgPool?.end) await pgPool.end().catch(() => {}); });
