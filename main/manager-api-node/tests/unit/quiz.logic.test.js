/**
 * Pure quiz selection logic (no DB): Age Band mapping and Current Level derivation.
 * Spec: docs/superpowers/specs/2026-08-04-quizzy-question-bank-design.md
 */

const {
  WIRE_AGE_BAND,
  deriveLevelState,
  countCompletedLevels
} = require('../../src/services/quiz.logic');

// ageBandFromBirthDate is gone (ticket 013). The bank is no longer partitioned by
// age at all — the column was dropped, and the range is carried by the Doors.
// What survives is the constant the published parent-app contract still shows.
describe('WIRE_AGE_BAND', () => {
  it("is the constant the frozen parent-app contract reports", () => {
    expect(WIRE_AGE_BAND).toBe('all');
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

/**
 * ADR-0010's threshold, and the hole it opens if applied as a flat count.
 *
 * `levelClearSlack` is tuned for the authored level size of ten. On a level
 * holding one or two questions a flat slack of 2 clears it with NOTHING
 * mastered — and since that holds for every level, the entire bank skips itself
 * into champion replay on a child's first session. Found 2026-08-20 when the
 * child-scope test (one question per level) started reporting level 1 replay
 * instead of level 2.
 */
describe('allowedUnmastered', () => {
  const { allowedUnmastered } = require('../../src/services/quiz.logic');

  it('allows the configured slack on a full-size level', () => {
    expect(allowedUnmastered(10, 2)).toBe(2); // the intended 8 of 10
  });

  it('allows nothing on levels too small to spare a fifth', () => {
    expect(allowedUnmastered(1, 2)).toBe(0);
    expect(allowedUnmastered(2, 2)).toBe(0);
    expect(allowedUnmastered(4, 2)).toBe(0);
  });

  it('never exceeds a fifth of the level', () => {
    expect(allowedUnmastered(5, 2)).toBe(1);
    expect(allowedUnmastered(20, 2)).toBe(2); // capped by the bank, not the share
  });

  it('is zero when the bank configures no slack (the ADR-0009 wall)', () => {
    expect(allowedUnmastered(10, 0)).toBe(0);
  });

  it('never returns a negative allowance', () => {
    expect(allowedUnmastered(0, 2)).toBe(0);
  });
});

describe('deriveLevelState with a threshold', () => {
  const { deriveLevelState } = require('../../src/services/quiz.logic');
  const bank = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: i + 1, level: 1 })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: i + 11, level: 2 })),
  ];
  const clear = (...ids) => new Set(ids.map(String));

  it('moves on once the level is mastered to the threshold', () => {
    const state = deriveLevelState(bank, clear(1, 2, 3, 4, 5, 6, 7, 8), new Set(), 2);
    expect(state.currentLevel).toBe(2);
  });

  it('holds the child while more than the slack remains', () => {
    const state = deriveLevelState(bank, clear(1, 2, 3, 4, 5, 6, 7), new Set(), 2);
    expect(state.currentLevel).toBe(1);
  });

  it('does not skip a one-question-per-level bank (the 2026-08-20 hole)', () => {
    const thin = [{ id: 1, level: 1 }, { id: 2, level: 2 }];
    const state = deriveLevelState(thin, clear(1), new Set(), 2);
    expect(state.currentLevel).toBe(2);
    expect(state.allCleared).toBe(false);
  });
});
