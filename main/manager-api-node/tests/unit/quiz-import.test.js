const { parseQuizRow, normalizeAgeBand, planImport } = require('../../scripts/lib/quiz-import');

const validRow = {
  code: '6-8-L01-Q01',
  age_band: '8',
  level: 1,
  category: 'animals',
  language: '',
  question_text: 'How many legs does a spider have?',
  answer_text: 'eight',
  accepted_answers: '8 | eight legs',
  active: '',
};

describe('parseQuizRow', () => {
  test('valid row parses with defaults applied', () => {
    const { data, error } = parseQuizRow(validRow);
    expect(error).toBeNull();
    expect(data).toEqual({
      code: '6-8-L01-Q01',
      question_text: 'How many legs does a spider have?',
      answer_text: 'eight',
      accepted_answers: ['8', 'eight legs'],
      category: 'animals',
      age_band: '8',
      level: 1,
      language: 'en',
      active: true,
    });
  });

  test('trims whitespace and lowercases language', () => {
    const { data } = parseQuizRow({ ...validRow, code: '  9+-L01-Q01 ', age_band: ' 9 ', language: ' EN ' });
    expect(data.code).toBe('9+-L01-Q01');
    expect(data.age_band).toBe('9');
    expect(data.language).toBe('en');
  });

  test('empty accepted_answers yields empty array, not [""]', () => {
    const { data } = parseQuizRow({ ...validRow, accepted_answers: '' });
    expect(data.accepted_answers).toEqual([]);
  });

  test.each([
    ['', true],
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['FALSE', false],
    ['0', false],
    ['no', false],
    ['n', false],
  ])('active "%s" -> %s', (input, expected) => {
    expect(parseQuizRow({ ...validRow, active: input }).data.active).toBe(expected);
  });

  test('an unrecognised active value is rejected, never silently left live', () => {
    const { data, error } = parseQuizRow({ ...validRow, active: 'maybe' });
    expect(data).toBeNull();
    expect(error).toMatch(/active/);
  });

  test('rejects values too long for their database column', () => {
    expect(parseQuizRow({ ...validRow, code: 'X'.repeat(51) }).error).toMatch(/code/);
    expect(parseQuizRow({ ...validRow, language: 'x'.repeat(11) }).error).toMatch(/language/);
    expect(parseQuizRow({ ...validRow, category: 'c'.repeat(101) }).error).toMatch(/category/);
    expect(parseQuizRow({ ...validRow, level: 99999999999 }).error).toMatch(/level/);
  });

  test('numeric-looking level from a spreadsheet cell is accepted', () => {
    expect(parseQuizRow({ ...validRow, level: '2' }).data.level).toBe(2);
  });

  test.each([
    ['missing code', { code: '' }, /code/],
    ['unknown age band', { age_band: '4-7' }, /age_band/],
    ['level zero', { level: 0 }, /level/],
    ['non-integer level', { level: 1.5 }, /level/],
    ['missing question', { question_text: '  ' }, /question_text/],
    ['missing answer', { answer_text: '' }, /answer_text/],
  ])('rejects %s', (_name, patch, pattern) => {
    const { data, error } = parseQuizRow({ ...validRow, ...patch });
    expect(data).toBeNull();
    expect(error).toMatch(pattern);
  });

  test('every age 3 to 10 is a valid band', () => {
    for (const band of ['3', '4', '5', '6', '7', '8', '9', '10']) {
      expect(parseQuizRow({ ...validRow, age_band: band }).error).toBeNull();
    }
  });

  // A bare age in a spreadsheet cell arrives as a NUMBER, not a string, and
  // numbers used to be handed straight to the Excel date-serial decoder — which
  // reads 4 as 4 January 1900 and mangles the band.
  test('accepts an age written as a number, not only as text', () => {
    for (const age of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const { data, error } = parseQuizRow({ ...validRow, age_band: age });
      expect(error).toBeNull();
      expect(data.age_band).toBe(String(age));
    }
  });

  test('rejects the retired band vocabulary, naming what is valid', () => {
    for (const band of ['3-5', '6-8', '9+']) {
      const { error } = parseQuizRow({ ...validRow, age_band: band });
      expect(error).toMatch(/age_band/);
      expect(error).toMatch(/10/);
    }
  });
});

// Spreadsheets silently turn a hyphenated cell like "6-8" into a date, and a
// bare age into a number. Both have to be handled before validation.
describe('normalizeAgeBand', () => {
  test('plain strings pass through trimmed', () => {
    expect(normalizeAgeBand('6-8')).toBe('6-8');
    expect(normalizeAgeBand('  3-5 ')).toBe('3-5');
    expect(normalizeAgeBand('9+')).toBe('9+');
  });

  // An age is a number in the cell, and a number used to mean "date serial".
  test('a bare age passes through as itself, not as a 1900 date', () => {
    for (const age of [3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(normalizeAgeBand(age)).toBe(String(age));
    }
  });

  // A date cell can only be an old-vocabulary band. There is nothing left to
  // recover it INTO, so it must stay unrecognisable for the caller to reject.
  test('a date-mangled old band survives as a non-band, in either locale', () => {
    expect(normalizeAgeBand(37050.00011574074)).toBe('6-8'); // 2001-06-08, en-US
    expect(normalizeAgeBand(37109)).toBe('8-6'); // 2001-08-06, en-IN
    expect(normalizeAgeBand(new Date(2001, 5, 8))).toBe('6-8');
    for (const value of ['6-8', '8-6']) {
      expect(parseQuizRow({ ...validRow, age_band: value }).error).toMatch(/age_band/);
    }
  });

  test('a date that matches no band is left as month-day for the error message', () => {
    expect(normalizeAgeBand(36988)).toBe('4-7'); // 2001-04-07
  });

  test('leaves unrecognisable values alone for the caller to reject', () => {
    expect(normalizeAgeBand('banana')).toBe('banana');
    expect(normalizeAgeBand('')).toBe('');
  });

  // The date-guess path is kept for exactly this: an old sheet whose "6-8" cell
  // Excel already baked into a date must be rejected legibly, not read as some
  // unrelated age.
  test('a date-mangled old-band cell is rejected, not silently reinterpreted', () => {
    const { data, error } = parseQuizRow({ ...validRow, age_band: 37050.00011574074 });
    expect(data).toBeNull();
    expect(error).toMatch(/age_band/);
  });
});

describe('planImport', () => {
  const level = (band, lvl, count, patch = () => ({})) =>
    Array.from({ length: count }, (_, i) => ({
      code: `${band}-L0${lvl}-Q${String(i + 1).padStart(2, '0')}`,
      age_band: band,
      level: lvl,
      category: 'science',
      language: 'en',
      question_text: `Question ${i + 1}?`,
      answer_text: 'answer',
      accepted_answers: '',
      active: '',
      ...patch(i),
    }));

  test('a complete level of ten is ready with nothing flagged', () => {
    const { ready, skipped, badLevels } = planImport(level('8', 1, 10));
    expect(ready).toHaveLength(10);
    expect(skipped).toEqual([]);
    expect(badLevels).toEqual([]);
  });

  test('a level of nine is flagged even though every row is valid', () => {
    const { ready, skipped, badLevels } = planImport(level('8', 1, 9));
    expect(ready).toHaveLength(9);
    expect(skipped).toEqual([]);
    expect(badLevels).toEqual([['8 / en / level 1', 9]]);
  });

  test('inactive rows do not count towards a level', () => {
    const rows = level('8', 1, 10, (i) => (i < 3 ? { active: 'false' } : {}));
    const { ready, badLevels } = planImport(rows);
    expect(ready).toHaveLength(10);
    expect(badLevels).toEqual([['8 / en / level 1', 7]]);
  });

  test('a duplicate code is skipped with its row number, not silently overwritten', () => {
    const rows = level('8', 1, 10);
    rows.push({ ...rows[0] });
    const { ready, skipped } = planImport(rows);
    expect(ready).toHaveLength(10);
    expect(skipped).toEqual(['row 12: duplicate code 8-L01-Q01 in this sheet']);
  });

  test('invalid rows are skipped by spreadsheet row number and the rest proceed', () => {
    const rows = level('8', 1, 10);
    rows[2].answer_text = '';
    const { ready, skipped, badLevels } = planImport(rows);
    expect(ready).toHaveLength(9);
    expect(skipped).toEqual(['row 4: answer_text is required']);
    expect(badLevels).toEqual([['8 / en / level 1', 9]]);
  });

  test('separate bands and languages are tallied independently', () => {
    const rows = [...level('8', 1, 10), ...level('4', 1, 10)];
    expect(planImport(rows).badLevels).toEqual([]);
  });

  test('an empty sheet plans nothing', () => {
    expect(planImport([])).toEqual({ ready: [], skipped: [], badLevels: [] });
  });
});
