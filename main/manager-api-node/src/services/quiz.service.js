/**
 * Quiz Service
 *
 * Selection side of the Quizzy Question Bank: picks the device's next batch of
 * scored questions. Progress is never stored — Cleared and Current Level are
 * derived from the quiz_question_answer log on every call, and nothing is
 * written on fetch.
 *
 * Spec: docs/superpowers/specs/2026-08-04-quizzy-question-bank-design.md
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { normalizeMacAddress } = require('../utils/helpers');
const { ageBandFromBirthDate, deriveLevelState } = require('./quiz.logic');

const DEFAULT_AGE_BAND = '6-8';
const DEFAULT_LANGUAGE = 'en';
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
    language: (kid?.language || DEFAULT_LANGUAGE).toLowerCase()
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

  return {
    age_band: context.ageBand,
    age_band_defaulted: context.ageBandDefaulted,
    language,
    level,
    replay,
    frontier_warning: frontierWarning,
    questions: bank.filter((q) => selected.has(String(q.id))).map(toQuestion)
  };
};

module.exports = {
  nextQuestions
};
