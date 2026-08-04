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

  it('maps age 4 to 3-5', () => {
    expect(ageBandFromBirthDate(new Date('2022-01-15'), now)).toBe('3-5');
  });

  it('maps a child whose 6th birthday is tomorrow to 3-5 (still 5)', () => {
    expect(ageBandFromBirthDate(new Date('2020-08-05'), now)).toBe('3-5');
  });

  it('maps a child whose 6th birthday is today to 6-8', () => {
    expect(ageBandFromBirthDate(new Date('2020-08-04'), now)).toBe('6-8');
  });

  it('maps age 8 to 6-8', () => {
    expect(ageBandFromBirthDate(new Date('2018-06-15'), now)).toBe('6-8');
  });

  it('maps a child whose 9th birthday is tomorrow to 6-8 (still 8)', () => {
    expect(ageBandFromBirthDate(new Date('2017-08-05'), now)).toBe('6-8');
  });

  it('maps a child whose 9th birthday is today to 9+', () => {
    expect(ageBandFromBirthDate(new Date('2017-08-04'), now)).toBe('9+');
  });

  it('maps age 12 to 9+', () => {
    expect(ageBandFromBirthDate(new Date('2014-02-01'), now)).toBe('9+');
  });

  it('accepts a date string as well as a Date', () => {
    expect(ageBandFromBirthDate('2018-06-15', now)).toBe('6-8');
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
