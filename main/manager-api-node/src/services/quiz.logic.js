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

// The share of a level ADR-0010's threshold may leave unmastered. The bank's
// `levelClearSlack` is an absolute count tuned for the authored level size of
// ten; applied blindly it is a hole, because a level holding one or two
// questions would clear with NOTHING mastered and the whole bank would skip
// itself. Caught by the child-scope test on 2026-08-20, whose synthetic bank
// holds one question per level.
const MAX_UNMASTERED_SHARE = 0.2;

/**
 * How many questions this level may leave unmastered: the bank's slack, capped
 * at a fifth of the level. A level of ten allows two (the intended 8-of-10);
 * levels of one to four allow none.
 *
 * @param {number} levelSize - active questions in the level
 * @param {number} slack - the bank's configured allowance
 * @returns {number}
 */
const allowedUnmastered = (levelSize, slack) =>
  Math.max(0, Math.min(slack, Math.floor(levelSize * MAX_UNMASTERED_SHARE)));

/**
 * Derive the device's Current Level: the lowest level that still has an
 * uncleared question. Never stored — adding a question to an already-cleared
 * level correctly pulls the child back to finish it.
 *
 * @param {Array<{id: *, level: number}>} questions - active bank for the band, any order
 * @param {Set<string>} clearedIds - cleared question ids as strings
 * @param {Set<number>} [skipLevels] - levels the anti-trap has already moved the
 *   child past (see agedOutLevels). Without this the lowest uncleared level is
 *   always the abandoned one, so the child is pulled back to it every session
 *   and the cap has to re-fire forever.
 * @param {number} [slack] - how many questions may stay unmastered and the level
 *   still count as finished (ADR-0010). 0 restores the ADR-0009 rule that every
 *   question must be cleared. The unmastered ones are not forgotten: they follow
 *   the child as bonus practice and the answer log still records them.
 * @returns {{currentLevel: number|null, unclearedIds: Array<*>, allCleared: boolean}}
 *   `allCleared` is false for an empty bank — there was nothing to clear.
 */
const deriveLevelState = (questions, clearedIds, skipLevels = new Set(), slack = 0) => {
  if (!questions.length) {
    return { currentLevel: null, unclearedIds: [], allCleared: false };
  }

  const levels = [...new Set(questions.map((q) => q.level))].sort((a, b) => a - b);

  for (const level of levels) {
    if (skipLevels.has(level)) continue;
    const inLevel = questions.filter((q) => q.level === level);
    const uncleared = inLevel.filter((q) => !clearedIds.has(String(q.id)));
    // Strictly greater: slack=2 means two may remain and the level is still done.
    if (uncleared.length > allowedUnmastered(inLevel.length, slack)) {
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
 * A level the anti-trap moved the child past also counts as finished. It is not
 * MASTERED and the answer log still says so question by question, but the child
 * will never be asked it again, so leaving it in the "not done yet" pile forever
 * describes nothing anybody can act on.
 *
 * A level finished on the threshold (ADR-0010) counts too, for the same reason:
 * the child has moved past it. "Completed" here has meant "will not be asked
 * again" since the anti-trap; it has never meant "mastered". Mastery is a
 * question-by-question read of the answer log.
 *
 * @param {Array<{id: *, level: number}>} questions - active bank for the band, any order
 * @param {Set<string>} clearedIds - cleared question ids as strings
 * @param {Set<number>} [skipLevels] - levels aged out by the cap
 * @param {number} [slack] - unmastered questions a finished level may still hold
 * @returns {number}
 */
const countCompletedLevels = (questions, clearedIds, skipLevels = new Set(), slack = 0) =>
  [...new Set(questions.map((q) => q.level))].filter((level) => {
    if (skipLevels.has(level)) return true;
    const inLevel = questions.filter((q) => q.level === level);
    const uncleared = inLevel.filter((q) => !clearedIds.has(String(q.id)));
    return uncleared.length <= allowedUnmastered(inLevel.length, slack);
  }).length;

/**
 * Levels the anti-trap has already moved the child past.
 *
 * A level ages out when its UNCLEARED questions have been answered on `cap` or
 * more distinct days. Counting days only on the questions still outstanding is
 * deliberate: days spent on questions the child already got right are not days
 * spent stuck, and counting them would age a level out early.
 *
 * It also keeps the deliberate pull-back working. Adding a question to a level
 * the child finished months ago must reopen that level (deriveLevelState's whole
 * reason for being derived) — the new question has zero days against it, so the
 * level is not aged out and the child is sent back to finish it.
 *
 * The highest level is never aged out: there is nowhere to advance to, so
 * skipping it would silently read as "every level cleared" and start replay.
 *
 * @param {Array<{id: *, level: number}>} questions - active bank for the band
 * @param {Set<string>} clearedIds - cleared question ids as strings
 * @param {Map<string, Set<string>>} daysByQuestionId - question id -> distinct day keys
 * @param {number} cap - ANTI_TRAP_DAY_CAP
 * @returns {Set<number>}
 */
const agedOutLevels = (questions, clearedIds, daysByQuestionId, cap) => {
  const levels = [...new Set(questions.map((q) => q.level))].sort((a, b) => a - b);
  const top = levels[levels.length - 1];
  const out = new Set();

  for (const level of levels) {
    if (level === top) continue;
    const uncleared = questions.filter(
      (q) => q.level === level && !clearedIds.has(String(q.id))
    );
    if (!uncleared.length) continue; // mastered, not aged out

    const days = new Set();
    for (const q of uncleared) {
      for (const day of daysByQuestionId.get(String(q.id)) || []) days.add(day);
    }
    if (days.size >= cap) out.add(level);
  }

  return out;
};

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
  agedOutLevels,
  levelCompletedToday,
  allowedUnmastered
};
