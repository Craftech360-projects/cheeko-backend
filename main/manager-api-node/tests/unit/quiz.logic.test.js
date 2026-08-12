/**
 * Pure quiz selection logic (no DB): Age Band mapping and Current Level derivation.
 * Spec: docs/superpowers/specs/2026-08-04-quizzy-question-bank-design.md
 */

const {
  ageBandFromBirthDate,
  deriveLevelState,
  countCompletedLevels
} = require('../../src/services/quiz.logic');

describe('ageBandFromBirthDate', () => {
  const now = new Date('2026-08-04T10:00:00Z');

  it('returns null for a missing birth date', () => {
    expect(ageBandFromBirthDate(null, now)).toBeNull();
    expect(ageBandFromBirthDate(undefined, now)).toBeNull();
    expect(ageBandFromBirthDate('', now)).toBeNull();
  });

  it('returns null for an unparseable birth date', () => {
    expect(ageBandFromBirthDate('not-a-date', now)).toBeNull();
    expect(ageBandFromBirthDate(new Date('nope'), now)).toBeNull();
  });

  it('maps each age 3 to 10 to its own band', () => {
    // Birthday already passed this year, so the age is exact.
    const bornForAge = (age) => new Date(`${2026 - age}-01-15`);
    for (const age of [3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(ageBandFromBirthDate(bornForAge(age), now)).toBe(String(age));
    }
  });

  it('moves the child to the next band on their birthday, not before', () => {
    expect(ageBandFromBirthDate(new Date('2020-08-05'), now)).toBe('5'); // 6th is tomorrow
    expect(ageBandFromBirthDate(new Date('2020-08-04'), now)).toBe('6'); // 6th is today
  });

  it('clamps under-3s up to the youngest authored bank', () => {
    expect(ageBandFromBirthDate(new Date('2024-01-15'), now)).toBe('3'); // age 2
    expect(ageBandFromBirthDate(new Date('2026-01-15'), now)).toBe('3'); // age 0
  });

  it('clamps 10-and-over down to the oldest authored bank', () => {
    expect(ageBandFromBirthDate(new Date('2014-02-01'), now)).toBe('10'); // age 12
    expect(ageBandFromBirthDate(new Date('2005-02-01'), now)).toBe('10'); // age 21
  });

  it('clamps rather than returning null for a birth date in the future', () => {
    expect(ageBandFromBirthDate(new Date('2030-01-01'), now)).toBe('3');
  });

  it('accepts a date string as well as a Date', () => {
    expect(ageBandFromBirthDate('2018-06-15', now)).toBe('8');
  });
});

describe('deriveLevelState', () => {
  const questions = [
    { id: 1n, level: 1 },
    { id: 2n, level: 1 },
    { id: 3n, level: 2 },
    { id: 4n, level: 2 },
  ];

  it('returns level 1 with everything uncleared when nothing is cleared', () => {
    expect(deriveLevelState(questions, new Set())).toEqual({
      currentLevel: 1,
      unclearedIds: [1n, 2n],
      allCleared: false,
    });
  });

  it('keeps a partially cleared level current and returns only the remainder', () => {
    expect(deriveLevelState(questions, new Set(['1']))).toEqual({
      currentLevel: 1,
      unclearedIds: [2n],
      allCleared: false,
    });
  });

  it('advances to the next level once the level is fully cleared', () => {
    expect(deriveLevelState(questions, new Set(['1', '2']))).toEqual({
      currentLevel: 2,
      unclearedIds: [3n, 4n],
      allCleared: false,
    });
  });

  it('pulls the child back when a new question is added to a cleared level', () => {
    const withNewQuestion = [...questions, { id: 5n, level: 1 }];
    expect(deriveLevelState(withNewQuestion, new Set(['1', '2']))).toEqual({
      currentLevel: 1,
      unclearedIds: [5n],
      allCleared: false,
    });
  });

  it('reports allCleared with a null level when every question is cleared', () => {
    expect(deriveLevelState(questions, new Set(['1', '2', '3', '4']))).toEqual({
      currentLevel: null,
      unclearedIds: [],
      allCleared: true,
    });
  });

  it('treats an empty bank as not cleared (nothing to clear is not a win)', () => {
    expect(deriveLevelState([], new Set())).toEqual({
      currentLevel: null,
      unclearedIds: [],
      allCleared: false,
    });
  });

  it('picks the lowest level regardless of input ordering', () => {
    const unordered = [
      { id: 3n, level: 2 },
      { id: 1n, level: 1 },
      { id: 4n, level: 2 },
      { id: 2n, level: 1 },
    ];
    expect(deriveLevelState(unordered, new Set())).toEqual({
      currentLevel: 1,
      unclearedIds: [3n, 1n, 4n, 2n].filter((id) => id === 1n || id === 2n),
      allCleared: false,
    });
  });

  it('matches cleared ids by string, not by BigInt identity', () => {
    const numericIds = [{ id: 1, level: 1 }, { id: 2, level: 1 }];
    expect(deriveLevelState(numericIds, new Set(['1', '2']))).toEqual({
      currentLevel: null,
      unclearedIds: [],
      allCleared: true,
    });
  });
});

describe('countCompletedLevels', () => {
  const questions = [
    { id: 1n, level: 1 },
    { id: 2n, level: 1 },
    { id: 3n, level: 2 },
    { id: 4n, level: 2 },
  ];

  it('counts nothing for an empty bank', () => {
    expect(countCompletedLevels([], new Set())).toBe(0);
    expect(countCompletedLevels([], new Set(['1']))).toBe(0);
  });

  it('counts nothing when nothing is cleared', () => {
    expect(countCompletedLevels(questions, new Set())).toBe(0);
  });

  it('does not count a partially cleared level', () => {
    expect(countCompletedLevels(questions, new Set(['1']))).toBe(0);
  });

  it('counts a fully cleared level while the next one is still partial', () => {
    expect(countCompletedLevels(questions, new Set(['1', '2', '3']))).toBe(1);
  });

  it('counts a cleared upper level even when a lower one is incomplete', () => {
    expect(countCompletedLevels(questions, new Set(['3', '4']))).toBe(1);
  });

  it('counts every level once all questions are cleared', () => {
    expect(countCompletedLevels(questions, new Set(['1', '2', '3', '4']))).toBe(2);
  });

  it('matches cleared ids by string, not by BigInt identity', () => {
    const numericIds = [{ id: 1, level: 1 }, { id: 2, level: 1 }];
    expect(countCompletedLevels(numericIds, new Set(['1', '2']))).toBe(1);
  });
});

describe('levelCompletedToday', () => {
  const { levelCompletedToday } = require('../../src/services/quiz.logic');
  const bank = [
    { id: 1n, level: 1 }, { id: 2n, level: 1 },
    { id: 3n, level: 2 }, { id: 4n, level: 2 }
  ];

  it('is true when a question answered today finished its level', () => {
    expect(levelCompletedToday(bank, new Set(['1', '2']), ['2'])).toBe(true);
  });

  it('is false when the level still has uncleared questions', () => {
    expect(levelCompletedToday(bank, new Set(['1']), ['1'])).toBe(false);
  });

  it('is false when the level was already complete before today', () => {
    // Yesterday cleared level 1; today's answers are in level 2, still open.
    expect(levelCompletedToday(bank, new Set(['1', '2', '3']), ['3'])).toBe(false);
  });

  it('is false with no answers today', () => {
    expect(levelCompletedToday(bank, new Set(['1', '2']), [])).toBe(false);
  });

  it('ignores today-ids from outside this bank (a band switch mid-day)', () => {
    expect(levelCompletedToday(bank, new Set(['1', '2']), ['999'])).toBe(false);
  });
});
