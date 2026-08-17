#!/usr/bin/env node
/**
 * Replace the QUESTION banks from another database, leaving the answer log alone.
 *
 *   SRC_DATABASE_URL="<source>" node scripts/import-quiz-bank-questions.js
 *   SRC_DATABASE_URL="<source>" node scripts/import-quiz-bank-questions.js --apply
 *
 * copy-quiz-tables.js cannot be used against a database with real children on
 * it: it replaces `quiz_question_answer` and `riddle_question_answer` too, and
 * those are the answer LOG. This copies the question tables only.
 *
 * Old rows are RETIRED, never deleted. Two reasons, and both are load-bearing:
 *
 *   - The answer log's foreign key is ON DELETE RESTRICT, so a question a child
 *     has answered cannot be deleted at all.
 *   - `active = false` is how this codebase retires content already. Selection
 *     reads the active bank, so a retired question stops being served while the
 *     rows recording that a child answered it stay exactly as they were.
 *
 * Retiring rather than upserting by `code` is a deliberate choice. The codes
 * match across databases but the CONTENT behind them does not — the same code is
 * a different question, at a different level, after the re-levelling. Updating
 * in place would leave every existing answer row crediting a child for a
 * question they never heard. Retiring means their cleared set no longer matches
 * the active bank, so they restart at level 1: less progress, but true.
 *
 * `code` is unique, so retired rows are renamed out of the way to free the code
 * for its replacement. The original is kept in the new name.
 */
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const BANKS = [
  { question: 'quiz_question', label: 'quiz' },
  { question: 'riddle_question', label: 'riddle' },
];

const COLUMNS = [
  'code', 'question_text', 'answer_text', 'accepted_answers',
  'category', 'level', 'language', 'active', 'teach_text', 'distractors',
];

/**
 * Prisma 7 takes its connection through a driver adapter rather than a
 * `datasources` override, which is why this builds a pool per database instead
 * of reusing src/config/database — that module reads one URL from the env and
 * this script needs two at once.
 *
 * SSL is enabled only for remote hosts. A local rehearsal container speaks
 * plaintext and would refuse the handshake.
 */
const clientFor = (url) => {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
  const pool = new Pool({
    connectionString: url.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, ''),
    ssl: local ? false : { rejectUnauthorized: false },
  });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
};

(async () => {
  const apply = process.argv.includes('--apply');
  const srcUrl = process.env.SRC_DATABASE_URL;
  const dstUrl = process.env.DATABASE_URL;

  if (!srcUrl) throw new Error('SRC_DATABASE_URL is required');
  if (!dstUrl) throw new Error('DATABASE_URL is required');
  // The same guard copy-quiz-tables has. Importing a database into itself would
  // retire every question and then re-insert it under a new id, detaching the
  // whole answer log in one go.
  if (srcUrl === dstUrl) throw new Error('source and destination are the same database');

  const src = clientFor(srcUrl);
  const dst = clientFor(dstUrl);
  const stamp = new Date().toISOString().slice(0, 10);

  for (const bank of BANKS) {
    const incoming = await src[bank.question].findMany({
      where: { active: true },
      select: Object.fromEntries(COLUMNS.map((c) => [c, true])),
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
    });
    const existing = await dst[bank.question].count({ where: { active: true } });
    const levels = [...new Set(incoming.map((q) => q.level))].sort((a, b) => a - b);

    console.log(`\n${bank.label}: retire ${existing} active -> import ${incoming.length}`);
    console.log(`  levels: ${levels.length} (${levels[0]}..${levels[levels.length - 1]}), ` +
      `${levels.map((l) => incoming.filter((q) => q.level === l).length).join('/')} per level`);

    if (!apply) continue;

    await dst.$transaction(async (tx) => {
      // Rename first so the codes are free, then flip active. One statement each
      // rather than a loop: the whole bank moves or none of it does.
      await tx.$executeRawUnsafe(
        `UPDATE ${bank.question} SET code = 'retired-${stamp}-' || code, active = false, update_date = now() WHERE active = true`
      );
      await tx[bank.question].createMany({ data: incoming });
    });

    const now = await dst[bank.question].count({ where: { active: true } });
    console.log(`  done: ${now} active`);
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing was written. Pass --apply.');
  } else {
    console.log('\nThe answer log was not touched. Children whose cleared questions are now');
    console.log('retired will derive as level 1, which is what "retired content" means.');
  }

  await src.$disconnect();
  await dst.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
