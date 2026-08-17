#!/usr/bin/env node
/**
 * Tick Prisma's checklist for migrations that were already applied by hand.
 *
 *   node scripts/baseline-prisma-migrations.js            # dry run, prints the plan
 *   node scripts/baseline-prisma-migrations.js --apply    # runs `migrate resolve --applied`
 *
 * Production's schema was built outside Prisma: the tables exist, but
 * `_prisma_migrations` is empty, so `migrate deploy` starts at the first
 * migration, hits "already exists", records P3009 and refuses to do anything
 * else — and `server.js` exits code 1 on every restart after that.
 *
 * Baselining writes ONLY to `_prisma_migrations`. It creates nothing, drops
 * nothing and changes no data. What it does do is tell Prisma never to run those
 * migrations, which is why this checks before it ticks: marking a migration
 * applied when it was NOT already done means that change silently never happens,
 * and it surfaces weeks later as a missing column.
 *
 * So each migration is classified by looking for the objects it creates:
 *
 *   PRESENT  every object it creates already exists   -> tick
 *   ABSENT   none of them exist                       -> leave it for migrate deploy
 *   PARTIAL  some do, some do not                     -> report, never tick
 *   UNKNOWN  nothing detectable to check              -> report, never tick
 *
 * PARTIAL and UNKNOWN are the interesting ones. They mean the hand-built schema
 * drifted from the migration history, and a human has to decide.
 */
require('dotenv/config');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
// The app's own client rather than a fresh PrismaClient: Prisma 7 needs an
// explicit adapter and datasource, and src/config/database already builds it the
// way every other script and the server itself do.
const { prisma } = require('../src/config/database');
const MIGRATIONS_DIR = path.resolve(__dirname, '../prisma/migrations');

/**
 * The objects a migration creates, as evidence that it ran.
 *
 * Deliberately shallow: CREATE TABLE and ADD COLUMN are the two that leave a
 * mark we can check cheaply and unambiguously. Indexes and constraints are
 * skipped — they are renamed and re-created often enough that their absence
 * proves nothing, and a false ABSENT is worse than an honest UNKNOWN.
 */
const evidenceFor = (sql) => {
  const tables = [];
  const columns = [];

  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w.]+)"?/gi;
  for (const m of sql.matchAll(tableRe)) tables.push(m[1].replace(/^public\./, ''));

  const columnRe = /ALTER\s+TABLE\s+(?:ONLY\s+)?"?([\w.]+)"?[\s\S]{0,80}?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi;
  for (const m of sql.matchAll(columnRe)) {
    columns.push({ table: m[1].replace(/^public\./, ''), column: m[2] });
  }

  return { tables, columns };
};

(async () => {
  const apply = process.argv.includes('--apply');

  const names = fs.readdirSync(MIGRATIONS_DIR)
    .filter((n) => fs.existsSync(path.join(MIGRATIONS_DIR, n, 'migration.sql')))
    .sort();

  const alreadyRecorded = new Set(
    (await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations`)
      .map((r) => r.migration_name)
  );

  const dbTables = new Set(
    (await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)
      .map((r) => r.table_name)
  );
  const dbColumns = new Set(
    (await prisma.$queryRaw`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`)
      .map((r) => `${r.table_name}.${r.column_name}`)
  );

  const plan = [];
  for (const name of names) {
    if (alreadyRecorded.has(name)) {
      plan.push({ name, verdict: 'RECORDED', detail: 'already on the checklist' });
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
    const { tables, columns } = evidenceFor(sql);

    const checks = [
      ...tables.map((t) => ({ what: `table ${t}`, ok: dbTables.has(t) })),
      ...columns.map((c) => ({ what: `${c.table}.${c.column}`, ok: dbColumns.has(`${c.table}.${c.column}`) })),
    ];

    if (!checks.length) {
      plan.push({ name, verdict: 'UNKNOWN', detail: 'no CREATE TABLE or ADD COLUMN to check' });
      continue;
    }

    const present = checks.filter((c) => c.ok);
    const missing = checks.filter((c) => !c.ok);

    if (!missing.length) plan.push({ name, verdict: 'PRESENT', detail: `${checks.length} object(s) exist` });
    else if (!present.length) plan.push({ name, verdict: 'ABSENT', detail: `${checks.length} object(s) missing` });
    else {
      plan.push({
        name, verdict: 'PARTIAL',
        detail: `present: ${present.map((c) => c.what).join(', ')} | MISSING: ${missing.map((c) => c.what).join(', ')}`,
      });
    }
  }

  const width = Math.max(...plan.map((p) => p.name.length));
  for (const p of plan) console.log(`${p.verdict.padEnd(8)} ${p.name.padEnd(width)}  ${p.detail}`);

  const tick = plan.filter((p) => p.verdict === 'PRESENT');
  const leave = plan.filter((p) => p.verdict === 'ABSENT');
  const stop = plan.filter((p) => p.verdict === 'PARTIAL' || p.verdict === 'UNKNOWN');

  console.log(`\n  tick as applied : ${tick.length}`);
  console.log(`  leave for deploy: ${leave.length}${leave.length ? '  (' + leave.map((p) => p.name).join(', ') + ')' : ''}`);
  console.log(`  NEEDS A DECISION: ${stop.length}`);

  if (stop.length) {
    console.log('\n  These are not ticked and not left alone — they mean the hand-built schema');
    console.log('  drifted from the migration history. Read them before going further.');
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing was written. Pass --apply to tick the PRESENT ones.');
    await prisma.$disconnect();
    return;
  }

  // Only PRESENT is ever ticked. PARTIAL and UNKNOWN are deliberately left for a
  // human, and ABSENT must stay unticked so `migrate deploy` still runs it.
  for (const p of tick) {
    console.log(`resolving --applied ${p.name}`);
    execSync(`npx prisma migrate resolve --applied ${p.name}`, {
      cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
    });
  }
  console.log(`\nTicked ${tick.length}. Nothing else was touched.`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  try { await prisma.$disconnect(); } catch { /* already gone */ }
  process.exit(1);
});
