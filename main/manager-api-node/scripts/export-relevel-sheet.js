#!/usr/bin/env node
/**
 * Export a re-levelling worksheet for ticket 014.
 *
 *   node scripts/export-relevel-sheet.js [--bank riddle] [--out FILE.xlsx]
 *
 * Produces a sheet the existing importer can read straight back, with `level`
 * pre-filled by a SUGGESTION and teach_text/distractors left empty for a human.
 *
 * The suggested order is not invented. Every `code` still carries the authoring
 * provenance the dropped age_band column used to hold — the band (3-5, 6-8, 9+),
 * the original level within that band, and the per-age variant suffix. Sorting
 * by that re-expresses the original authors' own difficulty judgement as one
 * ladder, which is a far better starting point than alphabetical or random.
 *
 * It is a STARTING POINT, not an answer: a 3-5 level-3 question may well be
 * harder than a 6-8 level-1 one. The `level` column is there to be overwritten.
 */
require('dotenv/config');
const path = require('path');
const XLSX = require('xlsx');
const { prisma, pgPool } = require('../src/config/database');
const { resolveBank, DEFAULT_BANK } = require('../src/services/banks');

const PER_LEVEL = 10;
const BAND_ORDER = { '3-5': 0, '6-8': 1, '9+': 2, '9': 2 };

// code looks like "6-8-L02-Q07-a6": band, original level, question, age variant.
const provenance = (code) => {
  const m = String(code).match(/^(\d+(?:-\d+)?|\d\+)-L(\d+)-Q(\d+)(?:-a(\d+))?/i);
  if (!m) return { band: 'zz', bandRank: 99, level: 99, question: 99, age: 99 };
  return {
    band: m[1],
    bandRank: BAND_ORDER[m[1]] ?? 98,
    level: Number(m[2]),
    question: Number(m[3]),
    age: m[4] ? Number(m[4]) : 0,
  };
};

async function main() {
  const args = process.argv.slice(2);
  const bankIndex = args.indexOf('--bank');
  const bankName = bankIndex === -1 ? DEFAULT_BANK : args[bankIndex + 1];
  const tables = resolveBank(bankName);
  const outIndex = args.indexOf('--out');
  const out = outIndex === -1 ? `relevel-${bankName}.xlsx` : args[outIndex + 1];

  const rows = await tables.questions.findMany({
    where: { active: true },
    select: {
      code: true, level: true, category: true, language: true,
      question_text: true, answer_text: true, accepted_answers: true,
      teach_text: true, distractors: true,
    },
  });

  const sorted = rows
    .map((r) => ({ r, p: provenance(r.code) }))
    .sort((a, b) =>
      a.p.bandRank - b.p.bandRank ||
      a.p.level - b.p.level ||
      a.p.age - b.p.age ||
      a.p.question - b.p.question ||
      String(a.r.code).localeCompare(String(b.r.code)));

  const sheet = sorted.map(({ r, p }, i) => ({
    code: r.code,
    // The suggestion. Overwrite freely — this column is what gets imported.
    level: Math.floor(i / PER_LEVEL) + 1,
    question_text: r.question_text,
    answer_text: r.answer_text,
    accepted_answers: Array.isArray(r.accepted_answers) ? r.accepted_answers.join(' | ') : '',
    // Empty on purpose. Authored by a human, never generated: a distractor is a
    // scored choice and teach_text is spoken to a child as fact.
    teach_text: r.teach_text || '',
    distractors: Array.isArray(r.distractors) ? r.distractors.join(' | ') : '',
    category: r.category || '',
    language: r.language,
    active: 'true',
    // Reference only — the importer ignores these.
    was_level: r.level,
    source_band: p.band,
    source_level: p.level,
    source_age: p.age || '',
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'questions');
  XLSX.writeFile(wb, out);

  const levels = Math.ceil(sheet.length / PER_LEVEL);
  console.log(`${bankName}: ${sheet.length} active questions -> ${levels} levels of ${PER_LEVEL} -> ${path.resolve(out)}`);
  console.log(`teach_text to author: ${sheet.filter((s) => !s.teach_text).length}`);
  console.log(`distractors to author: ${sheet.filter((s) => !s.distractors).length}`);
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    if (pgPool?.end) await pgPool.end().catch(() => {});
  });
