#!/usr/bin/env node
/**
 * Import a question bank from a spreadsheet.
 *
 *   node scripts/import-quiz-questions.js path/to/bank.xlsx [--dry-run] [--bank riddle]
 *
 * Serves both Quizzy and Riddler: --bank picks the target tables, defaulting to
 * the quiz bank so existing invocations are unchanged. The two banks are
 * column-identical, so the parsing and validation rules are shared.
 *
 * Upserts by `code`, so re-running the same sheet is idempotent. Invalid rows
 * are reported with their spreadsheet row number and skipped; the rest import.
 * Exits non-zero if anything was skipped, so a half-failed import is not
 * mistaken for success.
 *
 * Sheet columns (row 1 headers):
 *   code, age_band, level, category, language, question_text, answer_text,
 *   accepted_answers (| separated), active
 */

require('dotenv/config');
const XLSX = require('xlsx');
const { prisma, pgPool } = require('../src/config/database');
const { planImport } = require('./lib/quiz-import');
const { resolveBank, DEFAULT_BANK } = require('../src/services/banks');

const REQUIRED_HEADERS = ['code', 'age_band', 'level', 'question_text', 'answer_text'];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const bankIndex = args.indexOf('--bank');
  // A bare "--bank" with no value must not fall through to the quiz bank:
  // resolveBank's default would silently accept undefined, and importing 90
  // riddles into the quiz bank is not a mistake worth defaulting through.
  if (bankIndex !== -1 && !args[bankIndex + 1]) {
    throw new Error('--bank needs a value (quiz or riddle)');
  }
  const bankName = bankIndex === -1 ? DEFAULT_BANK : args[bankIndex + 1];
  const tables = resolveBank(bankName);

  // The bank NAME is an argument too; skipping it stops "--bank riddle" from
  // being read as the filename when the file comes last.
  const file = args.find((arg, i) => !arg.startsWith('--') && i !== bankIndex + 1);

  if (!file) {
    throw new Error(
      'usage: node scripts/import-quiz-questions.js <bank.xlsx> [--dry-run] [--bank quiz|riddle]'
    );
  }

  // raw:true keeps text cells as text — without it the reader turns the age
  // band "6-8" into a date. parseQuizRow recovers dates that a real .xlsx
  // already baked in.
  const workbook = XLSX.readFile(file, { raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error(`${file} contains no sheets`);

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  if (!rows.length) throw new Error(`sheet "${sheetName}" has no data rows`);

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !(header in rows[0]));
  if (missingHeaders.length) {
    throw new Error(
      `sheet "${sheetName}" is missing required column(s): ${missingHeaders.join(', ')}. ` +
        `Row 1 must hold the column headers.`
    );
  }

  const { ready, skipped, badLevels } = planImport(rows);
  let imported = 0;

  for (const { data, sheetRow } of ready) {
    try {
      if (!dryRun) {
        await tables.questions.upsert({
          where: { code: data.code },
          create: data,
          update: { ...data, update_date: new Date() },
        });
      }
      imported += 1;
    } catch (dbError) {
      skipped.push(`row ${sheetRow}: ${data.code}: ${dbError.message}`);
    }
  }

  skipped.forEach((message) => console.error(message));

  // A Level is ten live questions; anything else is an authoring mistake worth
  // failing on here rather than discovering in a child's session.
  badLevels.forEach(([key, count]) =>
    console.error(`error: ${key} has ${count} active question(s), expected 10`)
  );

  console.log(
    `${dryRun ? '[dry-run] ' : ''}bank=${bankName} imported ${imported}, skipped ${skipped.length} (of ${rows.length} rows)`
  );
  if (skipped.length || badLevels.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    // PrismaPg does not own the pg Pool it was handed, so $disconnect alone
    // leaves the process hanging (same pattern as the backfill scripts).
    await prisma.$disconnect().catch(() => {});
    if (pgPool?.end) await pgPool.end().catch(() => {});
  });
