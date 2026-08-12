/**
 * Quiz Question Bank import — row parsing.
 *
 * Kept separate from the script entrypoint so the validation rules are testable
 * without a database.
 */

const XLSX = require('xlsx');

// One bank per age, 3..10 — see picoclaw docs/issues/per-age-banks/000-design.md.
// The retired '3-5'/'6-8'/'9+' vocabulary is deliberately absent so an old sheet
// is rejected loudly instead of importing content nobody will ever be served.
const AGE_BANDS = new Set(['3', '4', '5', '6', '7', '8', '9', '10']);
const TRUTHY_ACTIVE = ['', 'true', '1', 'yes', 'y'];
const FALSY_ACTIVE = ['false', '0', 'no', 'n'];

// Column widths from prisma/schema.prisma; a row that exceeds one of these
// would throw at insert time and abort the import mid-sheet.
const MAX_CODE = 50;
const MAX_LANGUAGE = 10;
const MAX_CATEGORY = 100;
const MAX_LEVEL = 2147483647;

const str = (value) => String(value ?? '').trim();

/**
 * Undo the spreadsheet's date guess for age bands.
 *
 * A band is now a single age, which is never date-like — but the cell still
 * arrives as a NUMBER when the author typed a bare 4, and handing that to the
 * date-serial decoder reads it as 4 January 1900. So a value that is already a
 * band is returned before any date handling.
 *
 * The date path stays for the retired vocabulary: Excel bakes "6-8" into a Date
 * or a serial, and which date depends on the author's locale — month-day (en-US)
 * gives June 8, day-month (en-IN, en-GB) gives 6 August. Neither orientation is a
 * valid band any more, so such a row is rejected by the caller with the offending
 * value shown, rather than silently reinterpreted as some unrelated age.
 *
 * @param {string|number|Date} value
 * @returns {string}
 */
function normalizeAgeBand(value) {
  let month;
  let day;

  // Before the date guess, not after: 4 is an age, not 4 January 1900.
  if (AGE_BANDS.has(str(value))) return str(value);

  if (value instanceof Date) {
    month = value.getMonth() + 1;
    day = value.getDate();
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return str(value);
    month = parsed.m;
    day = parsed.d;
  } else {
    return str(value);
  }

  const monthDay = `${month}-${day}`;
  const dayMonth = `${day}-${month}`;
  if (AGE_BANDS.has(monthDay)) return monthDay;
  if (AGE_BANDS.has(dayMonth)) return dayMonth;
  return monthDay;
}

/**
 * Parse one spreadsheet row into a quiz_question payload.
 *
 * @returns {{data: object|null, error: string|null}} error names the offending
 *   column so the caller can report `row N: <error>` and skip it.
 */
function parseQuizRow(row) {
  const code = str(row.code);
  if (!code) return { data: null, error: 'code is required' };
  if (code.length > MAX_CODE) {
    return { data: null, error: `code must be ${MAX_CODE} characters or fewer (got ${code.length})` };
  }

  const ageBand = normalizeAgeBand(row.age_band);
  if (!AGE_BANDS.has(ageBand)) {
    return {
      data: null,
      error: `age_band must be one of ${[...AGE_BANDS].join(', ')} (got "${ageBand}")`,
    };
  }

  const level = Number(row.level);
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    return { data: null, error: `level must be a whole number >= 1 (got "${str(row.level)}")` };
  }

  const questionText = str(row.question_text);
  if (!questionText) return { data: null, error: 'question_text is required' };

  const answerText = str(row.answer_text);
  if (!answerText) return { data: null, error: 'answer_text is required' };

  const category = str(row.category);
  if (category.length > MAX_CATEGORY) {
    return { data: null, error: `category must be ${MAX_CATEGORY} characters or fewer (got ${category.length})` };
  }

  const language = str(row.language).toLowerCase() || 'en';
  if (language.length > MAX_LANGUAGE) {
    return { data: null, error: `language must be ${MAX_LANGUAGE} characters or fewer (got "${language}")` };
  }

  // Retiring a bad question relies on this column, so an unrecognised value is
  // rejected rather than defaulted to active.
  const rawActive = str(row.active).toLowerCase();
  if (!TRUTHY_ACTIVE.includes(rawActive) && !FALSY_ACTIVE.includes(rawActive)) {
    return { data: null, error: `active must be true or false (got "${rawActive}")` };
  }

  // A comma-separated cell would import as one nonsense answer no child says.
  const acceptedAnswers = str(row.accepted_answers)
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (acceptedAnswers.some((entry) => entry.includes(','))) {
    return { data: null, error: 'accepted_answers must be separated by "|", not commas' };
  }

  return {
    data: {
      code,
      question_text: questionText,
      answer_text: answerText,
      accepted_answers: acceptedAnswers,
      category: category || null,
      age_band: ageBand,
      level,
      language,
      active: !FALSY_ACTIVE.includes(rawActive),
    },
    error: null,
  };
}

/**
 * Validate a whole sheet before any database work.
 *
 * Pure: takes the rows sheet_to_json produced, returns what should be written,
 * what was rejected (with spreadsheet row numbers), and the per-level tallies
 * used to police the ten-questions-per-Level rule.
 *
 * @param {object[]} rows
 * @returns {{ready: object[], skipped: string[], badLevels: [string, number][]}}
 */
function planImport(rows) {
  const ready = [];
  const skipped = [];
  const seenCodes = new Set();
  const levelCounts = new Map();

  for (const [index, row] of rows.entries()) {
    const sheetRow = index + 2; // header is row 1
    const { data, error } = parseQuizRow(row);
    if (error) {
      skipped.push(`row ${sheetRow}: ${error}`);
      continue;
    }
    if (seenCodes.has(data.code)) {
      // Without this the later row silently overwrites the earlier one and the
      // Level quietly holds nine questions.
      skipped.push(`row ${sheetRow}: duplicate code ${data.code} in this sheet`);
      continue;
    }
    seenCodes.add(data.code);
    ready.push({ data, sheetRow });

    // Only live questions count towards a Level: ten rows of which three are
    // inactive is a seven-question Level.
    if (data.active) {
      const key = `${data.age_band} / ${data.language} / level ${data.level}`;
      levelCounts.set(key, (levelCounts.get(key) || 0) + 1);
    }
  }

  return {
    ready,
    skipped,
    badLevels: [...levelCounts.entries()].filter(([, count]) => count !== 10),
  };
}

module.exports = { parseQuizRow, normalizeAgeBand, planImport, AGE_BANDS };
