/**
 * Quiz Selection Logic (pure)
 *
 * No DB, no I/O — Age Band mapping and Current Level derivation only, so the
 * selection rules can be tested without a database.
 * Spec: docs/superpowers/specs/2026-08-04-quizzy-question-bank-design.md
 */

// The bank is no longer partitioned by age. WIRE_AGE_BAND is what the published
// parent-app contract still shows for `age_band` (ticket 005) — a constant kept
// on the wire so dropping the column reached no app developer.
const WIRE_AGE_BAND = 'all';

/**
 * Derive the device's Current Level: the lowest level that still has an
 * uncleared question. Never stored — adding a question to an already-cleared
 * level correctly pulls the child back to finish it.
 *
 * @param {Array<{id: *, level: number}>} questions - active bank for the band, any order
 * @param {Set<string>} clearedIds - cleared question ids as strings
 * @returns {{currentLevel: number|null, unclearedIds: Array<*>, allCleared: boolean}}
 *   `allCleared` is false for an empty bank — there was nothing to clear.
 */
const deriveLevelState = (questions, clearedIds) => {
  if (!questions.length) {
    return { currentLevel: null, unclearedIds: [], allCleared: false };
  }

  const levels = [...new Set(questions.map((q) => q.level))].sort((a, b) => a - b);

  for (const level of levels) {
    const uncleared = questions.filter(
      (q) => q.level === level && !clearedIds.has(String(q.id))
    );
    if (uncleared.length) {
      return {
        currentLevel: level,
        unclearedIds: uncleared.map((q) => q.id),
        allCleared: false
      };
    }
  }

  return { currentLevel: null, unclearedIds: [], allCleared: true };
};

/**
 * Count the levels the device has finished: every active question in the level
 * is Cleared. Independent of Current Level — a level cleared out of order (or
 * left behind when a new question reopened an earlier one) still counts.
 *
 * @param {Array<{id: *, level: number}>} questions - active bank for the band, any order
 * @param {Set<string>} clearedIds - cleared question ids as strings
 * @returns {number}
 */
const countCompletedLevels = (questions, clearedIds) =>
  [...new Set(questions.map((q) => q.level))].filter((level) =>
    questions.every((q) => q.level !== level || clearedIds.has(String(q.id)))
  ).length;

/**
 * Did one of today's answers finish its level? Finishing a level ends the
 * scored day: the Daily Ten is a cap, not a quota, so the next level must not
 * open on the same day just to fill the count. Levels completed before today
 * don't count — only a level that one of today's answers closed.
 *
 * @param {Array<{id: *, level: number}>} questions - active bank for the band
 * @param {Set<string>} clearedIds - cleared question ids as strings
 * @param {Array<string>} todayQuestionIds - question ids answered today, as strings
 * @returns {boolean}
 */
const levelCompletedToday = (questions, clearedIds, todayQuestionIds) => {
  const levelById = new Map(questions.map((q) => [String(q.id), q.level]));
  const todayLevels = new Set(
    todayQuestionIds.map((id) => levelById.get(String(id))).filter((l) => l !== undefined)
  );
  return [...todayLevels].some((level) =>
    questions.every((q) => q.level !== level || clearedIds.has(String(q.id)))
  );
};

module.exports = {
  WIRE_AGE_BAND,
  deriveLevelState,
  countCompletedLevels,
  levelCompletedToday
};
