#!/usr/bin/env node
/**
 * Assert the per-age bank migration landed correctly.
 *
 *   node scripts/verify-per-age-banks.js
 *
 * Checks the acceptance criteria of picoclaw issues
 * docs/issues/per-age-banks/001-per-age-content-exists.md and 005-retire-old-bands.md
 * against the live database, and exits non-zero if any fails. Read-only — safe
 * to run any time.
 *
 * Asserts the FINISHED state of the migration. Between 001 and 005 the old
 * bands are meant to still be active, so the retirement check fails on purpose
 * during that window — that is the check doing its job, not a broken script.
 */

require('dotenv/config');
const { prisma, pgPool } = require('../src/config/database');

const AGES = ['3', '4', '5', '6', '7', '8', '9', '10'];
const OLD_BANDS = ['3-5', '6-8', '9+'];
const BANKS = [
  { name: 'quiz', questions: 'quiz_question', answers: 'quiz_question_answer' },
  { name: 'riddle', questions: 'riddle_question', answers: 'riddle_question_answer' },
];

const failures = [];

const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

async function verifyBank({ name, questions, answers }) {
  console.log(`\n--- ${name} ---`);

  // Every age must be a complete bank: ten live questions per level, per
  // language. Nine of ten is the failure that only shows up mid-session.
  const groups = await prisma.$queryRawUnsafe(`
    SELECT age_band, language, level, count(*)::int AS active
    FROM ${questions} WHERE active AND age_band = ANY($1)
    GROUP BY 1,2,3 ORDER BY 1,2,3`, AGES);
  const short = groups.filter((g) => g.active !== 10);
  const missing = AGES.filter((age) => !groups.some((g) => g.age_band === age));
  check(
    groups.length > 0 && !short.length && !missing.length,
    'every age 3-10 has levels of exactly 10 active questions',
    `${groups.length} (age, language, level) groups` +
      (short.length ? `; short: ${short.map((g) => `${g.age_band}/${g.language}/L${g.level}=${g.active}`).join(', ')}` : '') +
      (missing.length ? `; missing ages: ${missing.join(', ')}` : '')
  );

  // Retired by issue 005, never deleted: loadBank filters on active, so
  // deactivating is what takes them out of play, while the answer log keeps
  // pointing at questions that still resolve.
  const [old] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE active)::int AS active
    FROM ${questions} WHERE age_band = ANY($1)`, OLD_BANDS);
  check(old.total > 0 && old.active === 0,
    'old band rows retired but still present',
    `${old.total - old.active}/${old.total} retired`);

  // The 001 remap copied answers onto the clones; 005 dropped the copies. A
  // survivor with a twin means the cleanup missed one and the lifetime tallies
  // are still double-counting.
  const [dupes] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM ${answers} a
    WHERE EXISTS (
      SELECT 1 FROM ${questions} old
      JOIN ${questions} clone ON clone.code LIKE old.code || '-a%'
      JOIN ${answers} twin ON twin.device_mac = a.device_mac AND twin.question_id = clone.id
                          AND twin.answered_at = a.answered_at AND twin.result = a.result
      WHERE old.id = a.question_id AND old.age_band = ANY($1))`, OLD_BANDS);
  check(dupes.n === 0, 'no superseded old-band answer copies remain', `${dupes.n} left`);

  // The reason the remap exists: a device must not lose its cleared questions.
  //
  // Only answers whose old band CONTAINS the device's current age can move: a
  // child who is 8 answered 3-5 content has no '-a8' twin of it, because age 8
  // is cloned from the 6-8 band. Those rows go dormant by design (000-design
  // §3) and are reported, not failed. Mappability is read off the clone join
  // rather than restated as a band table — one source of truth for the mapping.
  //
  // Counted as expected-vs-found rather than as orphans: before the clone rows
  // exist the orphan join matches nothing, which would read as a pass.
  const [remap] = await prisma.$queryRawUnsafe(`
    SELECT count(*) FILTER (WHERE clone.id IS NOT NULL)::int AS mappable,
           count(*) FILTER (WHERE clone.id IS NULL)::int AS dormant,
           count(*) FILTER (WHERE clone.id IS NOT NULL AND EXISTS (
             SELECT 1 FROM ${answers} dup
             WHERE dup.device_mac = a.device_mac AND dup.question_id = clone.id
               AND dup.answered_at = a.answered_at))::int AS remapped
    FROM ${answers} a
    JOIN ${questions} old ON old.id = a.question_id AND old.age_band = ANY($1)
    LEFT JOIN ai_device d ON lower(d.mac_address) = lower(a.device_mac)
    LEFT JOIN kid_profile k ON k.id = d.kid_id
    LEFT JOIN ${questions} clone ON clone.code = old.code || '-a' || (
      CASE WHEN k.birth_date IS NULL THEN 6
           ELSE greatest(3, least(10, date_part('year', age((now() AT TIME ZONE 'UTC')::date, k.birth_date))::int))
      END)::text
    `, OLD_BANDS);
  // No `mappable > 0` guard: once 005 has dropped the copies there is legitimately
  // nothing left to compare, and requiring some would fail the finished state. The
  // pre-migration vacuous pass this once guarded is caught louder by the first
  // check, which finds no per-age content at all.
  check(remap.remapped === remap.mappable,
    'every in-band answer has been remapped onto the device age bank',
    `${remap.remapped}/${remap.mappable} remapped, ${remap.dormant} dormant (answered outside the device's current age)`);

  // A code that outgrew VARCHAR(50) would have aborted the insert, but the
  // margin is what matters for the next suffix someone adds.
  const [len] = await prisma.$queryRawUnsafe(
    `SELECT max(length(code))::int AS max_len FROM ${questions}`);
  check(len.max_len <= 50, 'codes fit VARCHAR(50)', `longest ${len.max_len}`);
}

async function main() {
  for (const bank of BANKS) await verifyBank(bank);
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    // PrismaPg does not own the pg Pool it was handed, so $disconnect alone
    // leaves the process hanging (same pattern as the import scripts).
    await prisma.$disconnect().catch(() => {});
    if (pgPool?.end) await pgPool.end().catch(() => {});
  });
