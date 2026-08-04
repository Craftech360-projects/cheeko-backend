/**
 * Quiz Service
 *
 * Selection side of the Quizzy Question Bank: picks the device's next batch of
 * scored questions, logs the answers the worker reports, and aggregates them for
 * the parent portal. Progress is never stored — Cleared and Current Level are
 * derived from the quiz_question_answer log on every call, and nothing is
 * written on fetch.
 *
 * Spec: docs/superpowers/specs/2026-08-04-quizzy-question-bank-design.md
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { normalizeMacAddress } = require('../utils/helpers');
const { ApiError } = require('../middleware/errorHandler');
const { ageBandFromBirthDate, deriveLevelState, countCompletedLevels } = require('./quiz.logic');

const DEFAULT_AGE_BAND = '6-8';
const DEFAULT_LANGUAGE = 'en';
// kid_learning_progress.subject value for quiz milestones.
const QUIZ_SUBJECT = 'quiz';
// The Daily Ten: how many scored questions make a day complete.
const DAILY_QUESTION_TARGET = 10;
const ANSWER_RESULTS = ['correct', 'wrong', 'revealed'];
const CLEARED_RESULTS = ['correct', 'revealed'];
// Warn once the device is inside the top 3 authored levels of its band.
const FRONTIER_WARN_LEVELS = 3;

// MAC addresses are case-insensitive identifiers; ai_device stores them
// normalized (upper-case, colon separated) while callers send either case.
const macFilter = (deviceMac) => ({ equals: deviceMac, mode: 'insensitive' });

/**
 * Resolve the device's Age Band and language from its kid profile.
 * Missing device, missing kid, or missing birth date -> default band, flagged.
 */
const resolveDeviceContext = async (deviceMac) => {
  const normalizedMac = normalizeMacAddress(deviceMac) || deviceMac;

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { kid_id: true }
  });

  const kid = device?.kid_id
    ? await prisma.kid_profile.findUnique({
      where: { id: device.kid_id },
      select: { birth_date: true, language: true }
    })
    : null;

  const ageBand = ageBandFromBirthDate(kid?.birth_date ?? null, new Date());

  return {
    ageBand: ageBand || DEFAULT_AGE_BAND,
    ageBandDefaulted: ageBand === null,
    language: (kid?.language || DEFAULT_LANGUAGE).toLowerCase(),
    // Milestones are attributed to the child, not the device, so a sibling
    // inheriting a toy does not inherit their progress.
    kidId: device?.kid_id ?? null
  };
};

/**
 * Active questions for a band in the requested language, falling back to
 * English when the band has no content in that language.
 * @returns {Promise<{bank: Array, language: string}>}
 */
const loadBank = async (ageBand, language) => {
  const query = (lang) => prisma.quiz_question.findMany({
    where: { age_band: ageBand, language: lang, active: true },
    orderBy: [{ level: 'asc' }, { id: 'asc' }]
  });

  const bank = await query(language);
  if (bank.length || language === DEFAULT_LANGUAGE) {
    return { bank, language };
  }

  return { bank: await query(DEFAULT_LANGUAGE), language: DEFAULT_LANGUAGE };
};

/** Cleared = an answer row with result 'correct' or 'revealed' exists. */
const loadClearedIds = async (deviceMac, bank) => {
  if (!bank.length) return new Set();

  const rows = await prisma.quiz_question_answer.findMany({
    where: {
      device_mac: macFilter(deviceMac),
      question_id: { in: bank.map((q) => q.id) },
      result: { in: CLEARED_RESULTS }
    },
    select: { question_id: true }
  });

  return new Set(rows.map((row) => String(row.question_id)));
};

/**
 * Champion replay: every level is cleared, so re-open the least recently played
 * one (ordered by its most recent answer). Always the full level — a partially
 * played replay day does not resume.
 */
const leastRecentlyPlayedLevel = async (deviceMac, bank) => {
  const grouped = await prisma.quiz_question_answer.groupBy({
    by: ['question_id'],
    where: {
      device_mac: macFilter(deviceMac),
      question_id: { in: bank.map((q) => q.id) }
    },
    _max: { answered_at: true }
  });

  const lastAnsweredByQuestion = new Map(
    grouped.map((row) => [String(row.question_id), row._max.answered_at])
  );
  const lastPlayed = (level) => Math.max(
    ...bank
      .filter((q) => q.level === level)
      .map((q) => lastAnsweredByQuestion.get(String(q.id))?.getTime() ?? 0)
  );

  return [...new Set(bank.map((q) => q.level))]
    .sort((a, b) => lastPlayed(a) - lastPlayed(b))[0];
};

const toQuestion = (question) => ({
  id: String(question.id), // BigInt is not JSON-serialisable
  question_text: question.question_text,
  answer_text: question.answer_text,
  accepted_answers: question.accepted_answers
});

/**
 * The device's next batch of scored questions.
 *
 * @param {string} deviceMac
 * @returns {Promise<{age_band: string, age_band_defaulted: boolean, language: string,
 *   level: number|null, replay: boolean, frontier_warning: boolean, questions: Array}>}
 */
const nextQuestions = async (deviceMac) => {
  const context = await resolveDeviceContext(deviceMac);
  const { bank, language } = await loadBank(context.ageBand, context.language);
  const clearedIds = await loadClearedIds(deviceMac, bank);
  const state = deriveLevelState(bank.map((q) => ({ id: q.id, level: q.level })), clearedIds);

  let level = state.currentLevel;
  let selectedIds = state.unclearedIds;
  const replay = state.allCleared;

  if (replay) {
    level = await leastRecentlyPlayedLevel(deviceMac, bank);
    selectedIds = bank.filter((q) => q.level === level).map((q) => q.id);
  }

  const maxLevel = bank.length ? Math.max(...bank.map((q) => q.level)) : 0;
  const frontierWarning = level !== null && !replay && maxLevel - level < FRONTIER_WARN_LEVELS;
  if (frontierWarning || replay) {
    logger.warn(
      `[QUIZ] device ${deviceMac} at the authored frontier: level=${level} max_level=${maxLevel} band=${context.ageBand} replay=${replay}`
    );
  }

  const selected = new Set(selectedIds.map(String));

  // The day-gate is decided here, from the log, not left to the model. It kept
  // reading "the Daily Ten is complete" out of restored transcripts and
  // refusing to start a genuinely fresh day.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const answeredToday = await prisma.quiz_question_answer.count({
    where: { device_mac: macFilter(deviceMac), answered_at: { gte: startOfDay } }
  });

  return {
    age_band: context.ageBand,
    age_band_defaulted: context.ageBandDefaulted,
    language,
    level,
    replay,
    frontier_warning: frontierWarning,
    answered_today: answeredToday,
    day_complete: answeredToday >= DAILY_QUESTION_TARGET,
    questions: bank.filter((q) => selected.has(String(q.id))).map(toQuestion)
  };
};

/** Worker ids arrive as strings — BigInt columns are not JSON-serialisable. */
const toQuestionId = (questionId) => {
  try {
    return BigInt(questionId);
  } catch (err) {
    throw new ApiError(`question_id must be a numeric id, got "${questionId}"`, 400);
  }
};

/**
 * Log one answered question — the answer log is the only quiz write. A row with
 * result 'correct' or 'revealed' is what makes the question Cleared, so the next
 * fetch stops offering it.
 *
 * The MAC is stored as the caller sent it; reads match case-insensitively.
 *
 * @param {string} deviceMac
 * @param {string|number} questionId
 * @param {'correct'|'wrong'|'revealed'} result - validated here so a bad value is
 *   a 400 rather than the table CHECK constraint's 500
 * @returns {Promise<{id: string, question_id: string, result: string, answered_at: Date}>}
 */
const recordAnswer = async (deviceMac, questionId, result) => {
  if (!ANSWER_RESULTS.includes(result)) {
    throw new ApiError(`result must be one of: ${ANSWER_RESULTS.join(', ')}`, 400);
  }

  const id = toQuestionId(questionId);
  const question = await prisma.quiz_question.findUnique({
    where: { id },
    select: { id: true }
  });
  if (!question) {
    throw new ApiError(`unknown question_id: ${questionId}`, 400);
  }

  const row = await prisma.quiz_question_answer.create({
    data: { device_mac: deviceMac, question_id: id, result },
    select: { id: true, answered_at: true }
  });

  // The answer log stays the source of truth for what to ask next; this is a
  // derived milestone for the parent dashboard, which needs an achievement
  // MOMENT (for cards and notifications) that a recomputed value cannot give.
  // Never let a reporting write fail the answer that was just recorded.
  try {
    await recordLevelMilestone(deviceMac, id);
  } catch (error) {
    logger.warn(`[QUIZ] level milestone write failed for ${deviceMac}: ${error.message}`);
  }

  return {
    id: String(row.id),
    question_id: String(id),
    result,
    answered_at: row.answered_at
  };
};

/**
 * Upsert a kid_learning_progress row when an answer completes a Level.
 *
 * Reuses the existing progress table rather than adding a parallel one: it
 * already carries (kid, subject, topic) uniqueness, a score, a completed flag
 * and updated_at, which is exactly the achievement timestamp the dashboard
 * lacks today. No-ops when the device has no child profile.
 *
 * @param {string} deviceMac
 * @param {bigint} answeredQuestionId
 */
const recordLevelMilestone = async (deviceMac, answeredQuestionId) => {
  const context = await resolveDeviceContext(deviceMac);
  if (!context.kidId) return;

  const answered = await prisma.quiz_question.findUnique({
    where: { id: answeredQuestionId },
    select: { age_band: true, level: true, language: true }
  });
  if (!answered) return;

  const { bank } = await loadBank(answered.age_band, context.language);
  const levelQuestions = bank.filter((q) => q.level === answered.level);
  if (!levelQuestions.length) return;

  const clearedIds = await loadClearedIds(deviceMac, levelQuestions);
  if (!levelQuestions.every((q) => clearedIds.has(String(q.id)))) return;

  const scored = await prisma.quiz_question_answer.groupBy({
    by: ['result'],
    where: {
      device_mac: macFilter(deviceMac),
      question_id: { in: levelQuestions.map((q) => q.id) }
    },
    _count: { _all: true }
  });
  const tally = Object.fromEntries(scored.map((r) => [r.result, r._count._all]));

  const topic = `${answered.age_band} level ${answered.level}`;
  await prisma.kid_learning_progress.upsert({
    where: {
      kid_id_subject_topic: { kid_id: context.kidId, subject: QUIZ_SUBJECT, topic }
    },
    create: {
      kid_id: context.kidId,
      subject: QUIZ_SUBJECT,
      topic,
      score: tally.correct || 0,
      completed: true,
      metadata: {
        age_band: answered.age_band,
        level: answered.level,
        correct: tally.correct || 0,
        revealed: tally.revealed || 0,
        wrong: tally.wrong || 0,
        questions: levelQuestions.length
      }
    },
    update: {
      score: tally.correct || 0,
      completed: true,
      updated_at: new Date(),
      metadata: {
        age_band: answered.age_band,
        level: answered.level,
        correct: tally.correct || 0,
        revealed: tally.revealed || 0,
        wrong: tally.wrong || 0,
        questions: levelQuestions.length
      }
    }
  });

  logger.info(
    `[QUIZ] level complete: kid=${context.kidId} ${topic} correct=${tally.correct || 0}`
  );
};

/**
 * Read-only aggregate over the answer log for the parent portal. Same derived
 * state as the selection path — nothing here is stored.
 *
 * @param {string} deviceMac
 * @returns {Promise<{age_band: string, current_level: number|null, levels_completed: number,
 *   counts: Object<string, number>, last_played: Date|null}>}
 */
const progress = async (deviceMac) => {
  const context = await resolveDeviceContext(deviceMac);
  const { bank } = await loadBank(context.ageBand, context.language);
  const clearedIds = await loadClearedIds(deviceMac, bank);
  const state = deriveLevelState(bank.map((q) => ({ id: q.id, level: q.level })), clearedIds);

  // Counts are lifetime totals for the device, not band-scoped: a band change
  // must not erase what the child already answered.
  const grouped = await prisma.quiz_question_answer.groupBy({
    by: ['result'],
    where: { device_mac: macFilter(deviceMac) },
    _count: { _all: true },
    _max: { answered_at: true }
  });

  const counts = Object.fromEntries(ANSWER_RESULTS.map((result) => [result, 0]));
  let lastPlayed = null;
  for (const row of grouped) {
    counts[row.result] = row._count._all;
    if (row._max.answered_at && (!lastPlayed || row._max.answered_at > lastPlayed)) {
      lastPlayed = row._max.answered_at;
    }
  }

  return {
    age_band: context.ageBand,
    current_level: state.currentLevel,
    levels_completed: countCompletedLevels(bank, clearedIds),
    counts,
    last_played: lastPlayed
  };
};

module.exports = {
  nextQuestions,
  recordAnswer,
  progress
};
