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
const {
  WIRE_AGE_BAND, deriveLevelState, countCompletedLevels, agedOutLevels, levelCompletedToday
} = require('./quiz.logic');
const { resolveBank, clearedResultsFor, DEFAULT_BANK } = require('./banks');
const { spokenAnswerMatches } = require('./answer-normalise');

// One bank for everyone (ADR-0009, ticket 013). The age_band column is gone; the
// range is carried by the Doors, not by separate content per age.
const DEFAULT_LANGUAGE = 'en';
// The Daily Ten: how many scored questions make a day complete.
const DAILY_QUESTION_TARGET = 10;
const ANSWER_RESULTS = ['correct', 'wrong', 'revealed'];
// What CLEARS is now per bank (see banks.js clearOnReveal), not a module-level
// constant: Quizzy and Riddler share this service and want opposite answers.
// ANSWER_RESULTS stays global — what the worker may REPORT is the same for both.
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

  return {
    // Still reported: the parent app distinguishes "no child profile" from a
    // resolved one. It no longer selects any content.
    profileMissing: !kid?.birth_date,
    language: (kid?.language || DEFAULT_LANGUAGE).toLowerCase(),
    // Progress is attributed to the child, not the device, so a sibling
    // inheriting a toy does not inherit their progress.
    kidId: device?.kid_id ?? null,
    // As the caller sent it. Rows are written with the caller's spelling and
    // read case-insensitively, so the fallback has to match on the same value.
    deviceMac
  };
};

/**
 * Which answer rows belong to this session's child.
 *
 * A paired device reads by child and ignores the MAC entirely, so progress
 * follows the child to a new toy. An unpaired device falls back to its own MAC
 * — and must also require `kid_id IS NULL`, or a toy handed to a sibling before
 * the parent picks a child would read the previous child's entire log. That
 * guard is the whole reason the fallback is safe; do not drop it.
 */
const answerScope = (context) => (
  context.kidId
    ? { kid_id: context.kidId }
    : { device_mac: macFilter(context.deviceMac), kid_id: null }
);

/**
 * Active questions for a band in the requested language, falling back to
 * English when the band has no content in that language.
 * @returns {Promise<{bank: Array, language: string}>}
 */
const loadBank = async (tables, language) => {
  const query = (lang) => tables.questions.findMany({
    where: { language: lang, active: true },
    orderBy: [{ level: 'asc' }, { id: 'asc' }]
  });

  const bank = await query(language);
  if (bank.length || language === DEFAULT_LANGUAGE) {
    return { bank, language };
  }

  return { bank: await query(DEFAULT_LANGUAGE), language: DEFAULT_LANGUAGE };
};

/** Cleared = an answer row exists whose result clears, for THIS bank. */
const loadClearedIds = async (tables, scope, bank) => {
  if (!bank.length) return new Set();

  const rows = await tables.answers.findMany({
    where: {
      ...scope,
      question_id: { in: bank.map((q) => q.id) },
      result: { in: clearedResultsFor(tables) }
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
const leastRecentlyPlayedLevel = async (tables, scope, bank) => {
  const grouped = await tables.answers.groupBy({
    by: ['question_id'],
    where: {
      ...scope,
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

// The Door ladder. `open` is the plain ask, `choice` narrows to two, `guided`
// teaches and hands the question back. The model never picks — every rung is
// authored or resolved here (ADR-0005: the server owns game logic, the model
// voices it).
const ASK_MODES = ['open', 'choice', 'guided'];

/**
 * Door 2's two options, in a stable order.
 *
 * Seeded by question id so the same child hears the same order every time that
 * question is asked: a shuffle that moves would let a child learn "it's the
 * second one" on one day and be wrong the next, which teaches position rather
 * than the answer.
 */
const choiceOrderFor = (question) => {
  const distractors = Array.isArray(question.distractors) ? question.distractors : [];
  const decoy = distractors.find((d) => typeof d === 'string' && d.trim());
  // No authored distractor means no Door 2 for this question. Generating one
  // would be exactly the invented content ADR-0005 removed from scored play.
  if (!decoy) return null;
  const answerFirst = Number(BigInt(question.id) % 2n) === 0;
  return answerFirst ? [question.answer_text, decoy] : [decoy, question.answer_text];
};

/**
 * One served question, with its Door ladder attached.
 *
 * Every rung ships at fetch rather than being fetched per turn. The worker
 * escalates through what it was given, so a child who needs Door 2 does not wait
 * on an HTTP round trip mid-sentence — on a voice path that pause is the child
 * wondering if the toy broke. The model still chooses nothing: the options and
 * the teaching sentence were authored, and the server decided the order.
 *
 * `ask_mode` is the STARTING Door, and it is always `open`: a returning question
 * reopens at Door 1 by design (quizzy-doors.md), so there is no history to read
 * here. `attempt_no` is 1 for the same reason.
 */
const toQuestion = (question) => {
  const choiceOrder = choiceOrderFor(question);
  const teachText = typeof question.teach_text === 'string' && question.teach_text.trim()
    ? question.teach_text
    : null;

  return {
    id: String(question.id), // BigInt is not JSON-serialisable
    question_text: question.question_text,
    answer_text: question.answer_text,
    accepted_answers: question.accepted_answers,
    ask_mode: ASK_MODES[0],
    attempt_no: 1,
    // Omitted, not null, when the content for that Door has not been authored
    // yet — the whole bank is in that state until ticket 014 re-levels it. The
    // worker skips a Door it was given no content for rather than improvising.
    ...(choiceOrder ? { choice_order: choiceOrder } : {}),
    ...(teachText ? { teach_text: teachText } : {})
  };
};

// M3, the anti-trap rule (ADR-0009). A child who cannot master a level advances
// anyway after this many distinct days on it. Enforcement without an escape
// hatch is a trap, not a standard.
const ANTI_TRAP_DAY_CAP = 3;
// How many unmastered questions from a capped level ride along as bonus items.
// Small on purpose: they are practice, not a second Daily Ten.
const BONUS_CARRY = 2;

/**
 * Server-local midnight day key. The same boundary the Daily Ten gate uses —
 * two definitions of "day" in one file would eventually disagree by one, and the
 * disagreement shows up as a child gaining or losing a day.
 */
const dayKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/**
 * question id -> the distinct days it was answered on.
 *
 * Built from the ANSWER log, never the attempt log. The attempt write is allowed
 * to fail (ADR-0009), so a cap reading it would silently stop firing whenever it
 * did — and the child it was meant to rescue would stay trapped with nothing in
 * the logs to say why.
 */
const daysByQuestionId = (rows) => {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.question_id);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(dayKey(row.answered_at));
  }
  return map;
};

/**
 * The device's next batch of scored questions.
 *
 * @param {string} deviceMac
 * @param {'quiz'|'riddle'} [bankName]
 * @returns {Promise<{age_band: string, age_band_defaulted: boolean, language: string,
 *   level: number|null, replay: boolean, frontier_warning: boolean, questions: Array}>}
 */
const nextQuestions = async (deviceMac, bankName = DEFAULT_BANK) => {
  const tables = resolveBank(bankName);
  const context = await resolveDeviceContext(deviceMac);
  const scope = answerScope(context);
  const { bank, language } = await loadBank(tables, context.language);
  // One read of the log, then everything derives from it in memory: which
  // questions are cleared, and how many days each has been worked at. Two
  // queries used to answer those separately and could disagree about "day".
  const bankIds = new Set(bank.map((q) => String(q.id)));
  const answerRows = (await tables.answers.findMany({
    where: scope,
    select: { question_id: true, result: true, answered_at: true }
  })).filter((row) => bankIds.has(String(row.question_id)));

  const clearing = clearedResultsFor(tables);
  const clearedIds = new Set(
    answerRows.filter((row) => clearing.includes(row.result)).map((row) => String(row.question_id))
  );

  // Levels the cap already moved the child past. Without this the lowest
  // uncleared level is the abandoned one forever: the child is dragged back to
  // it at the start of every session and the cap has to fire again to push them
  // out, so the level they are really on never appears anywhere.
  const agedOut = agedOutLevels(bank, clearedIds, daysByQuestionId(answerRows), ANTI_TRAP_DAY_CAP);
  const state = deriveLevelState(
    bank.map((q) => ({ id: q.id, level: q.level })),
    clearedIds,
    agedOut
  );

  // A sitting is the WHOLE level, cleared questions included — not just the ones
  // still outstanding.
  //
  // Serving only the uncleared ones made a session as short as the number left:
  // clear nine of ten and the next day is a one-question session, after which
  // the model had nothing to ask and invented a question by walking to the next
  // id (seen live 2026-08-15, and the id it reached was a Level 2 question).
  //
  // Re-asking a cleared question cannot un-clear it: `cleared` means a clearing
  // answer row EXISTS, so a later miss adds a row without removing the old one.
  // Mastery stays cumulative (ADR-0009) and the level still clears the moment
  // its last outstanding question is answered right.
  const idsForLevel = (n) => bank.filter((q) => q.level === n).map((q) => q.id);

  let level = state.currentLevel;
  const replay = state.allCleared;

  if (replay) {
    level = await leastRecentlyPlayedLevel(tables, scope, bank);
  }
  let selectedIds = idsForLevel(level);

  // The cap has already been applied above — `level` IS the level past the
  // abandoned ones. What is left is to carry the unmastered questions along as
  // BONUS items: practice that never gates a level, which is also the
  // spaced-repetition pool ticket 009 had nothing to attach to. A query, not a
  // table (ADR-0005).
  const skipped = [...agedOut].filter((l) => level === null || l < level).sort((a, b) => b - a);
  const antiTrapAdvanced = skipped.length > 0 && !replay;
  // Only the most recently abandoned level's questions ride along. Carrying
  // every level the child ever aged out of would grow without bound.
  const bonusIds = antiTrapAdvanced
    ? bank
      .filter((q) => q.level === skipped[0] && !clearedIds.has(String(q.id)))
      .map((q) => q.id)
      .slice(0, BONUS_CARRY)
    : [];
  if (antiTrapAdvanced) {
    logger.warn(
      `[${tables.label}] anti-trap: device ${deviceMac} is past level ${skipped[0]} on ${ANTI_TRAP_DAY_CAP}+ days without mastering it; serving level ${level} with ${bonusIds.length} bonus question(s)`
    );
  }

  const maxLevel = bank.length ? Math.max(...bank.map((q) => q.level)) : 0;
  const frontierWarning = level !== null && !replay && maxLevel - level < FRONTIER_WARN_LEVELS;
  if (frontierWarning || replay) {
    logger.warn(
      `[${tables.label}] device ${deviceMac} at the authored frontier: level=${level} max_level=${maxLevel} replay=${replay}`
    );
  }

  const selected = new Set(selectedIds.map(String));
  const bonus = new Set(bonusIds.map(String));

  // The day-gate is decided here, from the log, not left to the model. It kept
  // reading "the Daily Ten is complete" out of restored transcripts and
  // refusing to start a genuinely fresh day.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayRows = await tables.answers.findMany({
    where: { ...scope, answered_at: { gte: startOfDay } },
    select: { question_id: true }
  });
  const answeredToday = todayRows.length;

  // Finishing a level also ends the scored day: the Daily Ten is a cap, not a
  // quota. Without this, a level finished on question 6 pulled 4 questions
  // from the next level the same day just to reach ten.
  const dayComplete = answeredToday >= DAILY_QUESTION_TARGET
    || levelCompletedToday(bank, clearedIds, todayRows.map((r) => String(r.question_id)));

  // Diagnostic-grade, like the attempt log: the quiz must still run if this read
  // fails. A missing wonder question costs a warm opening line, nothing more.
  let wonderQuestion = null;
  try {
    wonderQuestion = await lastWonderQuestion(context);
  } catch (error) {
    logger.warn(`[${tables.label}] wonder question read failed for ${deviceMac}: ${error.message}`);
  }

  return {
    // Frozen wire fields (ticket 005): constant now that the bank is shared.
    age_band: WIRE_AGE_BAND,
    age_band_defaulted: context.profileMissing,
    // Null when the child has never been left one. Never gates anything.
    wonder_question: wonderQuestion,
    language,
    level,
    replay,
    frontier_warning: frontierWarning,
    answered_today: answeredToday,
    day_complete: dayComplete,
    // Advancing by the cap is a different fact from advancing by mastery, and
    // the difference matters to anyone asking why a child moved on. Progress is
    // still derived, so this is a signal about THIS response, not stored state.
    anti_trap_advanced: antiTrapAdvanced,
    questions: [
      ...bank.filter((q) => selected.has(String(q.id))).map(toQuestion),
      // Bonus items are appended, flagged, and never counted towards clearing a
      // level. A missed bonus simply recycles.
      ...bank.filter((q) => bonus.has(String(q.id)))
        .map((q) => ({ ...toQuestion(q), bonus: true }))
    ]
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
 * @param {'quiz'|'riddle'} [bankName]
 * @returns {Promise<{id: string, question_id: string, result: string, answered_at: Date}>}
 */
/**
 * Save the Wonder Question a session ended on.
 *
 * Unscored and ungating by design: no answer row, no level, no streak. It exists
 * only so the next session can open by remembering it.
 *
 * Attributed to the child where one is known, falling back to the device, so a
 * child who changes toys keeps their own wondering.
 */
const recordWonderQuestion = async (deviceMac, question) => {
  const text = String(question ?? '').trim();
  if (!text) throw new ApiError('question is required', 400);
  // Long enough for a real question, short enough that a runaway model reply
  // cannot fill the column.
  if (text.length > 500) throw new ApiError('question must be 500 characters or fewer', 400);

  const context = await resolveDeviceContext(deviceMac);
  const row = await prisma.kid_wonder_question.create({
    data: { device_mac: deviceMac, kid_id: context.kidId ?? null, question: text },
    select: { id: true, asked_at: true },
  });
  return { id: String(row.id), question: text, asked_at: row.asked_at };
};

/**
 * The last Wonder Question this child was left with, or null.
 *
 * Read by child when there is one, else by device — mirroring answerScope, so an
 * unpaired toy handed to a sibling does not surface the previous child's
 * curiosity.
 */
const lastWonderQuestion = async (context) => {
  const where = context.kidId
    ? { kid_id: context.kidId }
    : { device_mac: macFilter(context.deviceMac), kid_id: null };
  const row = await prisma.kid_wonder_question.findFirst({
    where,
    orderBy: { asked_at: 'desc' },
    select: { question: true },
  });
  return row ? row.question : null;
};

/**
 * Log the tries for a question that never resolved.
 *
 * A session that ends mid-question produces no answer row, and until this
 * existed it produced no attempt rows either — the tries were held in the worker
 * and lost on teardown. That is exactly backwards: the child who tried six times
 * and gave up is the one worth seeing, and they were the only one leaving no
 * trace at all. Observed live 2026-08-14.
 *
 * Deliberately does NOT write an answer row. No verdict was reached, so claiming
 * one would put a result in the log the child never earned.
 *
 * @returns {Promise<{question_id: string, attempts_logged: number}>}
 */
const recordUnresolvedAttempts = async (deviceMac, questionId, bankName = DEFAULT_BANK, attempts = []) => {
  const tables = resolveBank(bankName);
  const id = toQuestionId(questionId);
  const question = await tables.questions.findUnique({ where: { id }, select: { id: true } });
  if (!question) {
    throw new ApiError(`unknown question_id: ${questionId}`, 400);
  }
  const context = await resolveDeviceContext(deviceMac);
  const count = await recordAttempts(deviceMac, context.kidId, bankName, id, attempts);
  return { question_id: String(id), attempts_logged: count };
};

/**
 * Write the per-try rows for one question.
 *
 * The worker sends the whole sequence with the final answer rather than posting
 * each try as it happens: a try is only interesting next to the ones around it,
 * and one write per question keeps this off the conversation's critical path.
 *
 * Ordinals are assigned here from array position, not taken from the caller.
 * The worker counts turns; letting it also name the ordinal would let a retry
 * or a dropped turn write attempt 3 twice.
 *
 * @param {string} deviceMac
 * @param {string|number|null} kidId
 * @param {string} bank
 * @param {bigint} questionId - already resolved by the caller
 * @param {Array<{verdict?: string, transcript?: string}>} attempts
 * @returns {Promise<number>} rows written
 */
const recordAttempts = async (deviceMac, kidId, bank, questionId, attempts) => {
  if (!Array.isArray(attempts) || attempts.length === 0) return 0;

  const rows = attempts.map((attempt, index) => ({
    device_mac: deviceMac,
    kid_id: kidId ?? null,
    bank,
    question_id: questionId,
    attempt_no: index + 1,
    // An intermediate try is by definition one that did not finish the question.
    verdict: ANSWER_RESULTS.includes(attempt?.verdict) ? attempt.verdict : 'wrong',
    // Empty string and whitespace both mean "nothing was heard", which is not
    // the same as a child who said something the recogniser mangled. Keep the
    // difference: null for silence, the raw text otherwise.
    transcript: typeof attempt?.transcript === 'string' && attempt.transcript.trim()
      ? attempt.transcript
      : null
  }));

  const { count } = await prisma.question_attempt.createMany({ data: rows });
  return count;
};

const recordAnswer = async (deviceMac, questionId, result, bankName = DEFAULT_BANK, attempts = []) => {
  if (!ANSWER_RESULTS.includes(result)) {
    throw new ApiError(`result must be one of: ${ANSWER_RESULTS.join(', ')}`, 400);
  }

  const tables = resolveBank(bankName);
  const id = toQuestionId(questionId);
  // Looked up in the CLAIMED bank: ids are per-table, so riddle 7 and quiz 7
  // both exist. Checking the wrong table would happily log an answer against a
  // question the child was never asked.
  const question = await tables.questions.findUnique({
    where: { id },
    select: { id: true, answer_text: true, accepted_answers: true }
  });
  if (!question) {
    throw new ApiError(`unknown question_id: ${questionId}`, 400);
  }

  // STT Layer 1 (GDD 6b). Speech recognition runs before the model judges, so a
  // child who said the right word can be marked wrong for a machine's mistake.
  // That used to cost one question; now it costs them another day on the level.
  //
  // Only ever upgrades, and only on an EXACT match after normalisation — "ate"
  // for eight, "8" for eight, "um, I think it's eight". A false accept teaches a
  // child that a wrong answer was right, which is worse than the miss, so
  // nothing fuzzy happens here. Phonetic matching is Layer 2 and needs measuring
  // against real transcripts first.
  if (result !== 'correct' && attempts.length) {
    const said = attempts[attempts.length - 1]?.transcript;
    if (spokenAnswerMatches(said, question.answer_text, question.accepted_answers)) {
      logger.info(
        `[${tables.label}] STT rescue: "${said}" matches "${question.answer_text}" for question ${id}; ${result} -> correct`
      );
      result = 'correct';
    }
  }

  // Resolved once and threaded into the milestone write, which used to resolve
  // it again. The child is what the row belongs to; the MAC records which toy
  // asked, and is what an unpaired device is read back by until it is paired.
  //
  // Unlike the milestone below, this is allowed to fail the answer. A row
  // written with the wrong scope is invisible to every later read and silently
  // costs the child that question forever, which is worse than the worker
  // retrying. Both lookups are primary-key reads on the DB the insert is about
  // to hit anyway, so there is no new failure mode in practice.
  const context = await resolveDeviceContext(deviceMac);

  const row = await tables.answers.create({
    data: { device_mac: deviceMac, kid_id: context.kidId, question_id: id, result },
    select: { id: true, answered_at: true }
  });

  // The answer log stays the source of truth for what to ask next; this is a
  // derived milestone for the parent dashboard, which needs an achievement
  // MOMENT (for cards and notifications) that a recomputed value cannot give.
  // Never let a reporting write fail the answer that was just recorded.
  try {
    await recordLevelMilestone(tables, context, id);
  } catch (error) {
    logger.warn(`[${tables.label}] level milestone write failed for ${deviceMac}: ${error.message}`);
  }

  // Diagnostic, and allowed to fail (ADR-0009): a lost attempt row costs one
  // measurement, while failing here would cost the child the answer they just
  // earned. Nothing that gates progression reads these rows.
  try {
    await recordAttempts(deviceMac, context.kidId, bankName, id, attempts);
  } catch (error) {
    logger.warn(`[${tables.label}] attempt log write failed for ${deviceMac}: ${error.message}`);
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
 * @param {object} tables - the resolved bank
 * @param {object} context - the resolved device context, from recordAnswer
 * @param {bigint} answeredQuestionId
 */
const recordLevelMilestone = async (tables, context, answeredQuestionId) => {
  if (!context.kidId) return;
  const scope = answerScope(context);

  const answered = await tables.questions.findUnique({
    where: { id: answeredQuestionId },
    select: { level: true, language: true }
  });
  if (!answered) return;

  const { bank } = await loadBank(tables, context.language);
  const levelQuestions = bank.filter((q) => q.level === answered.level);
  if (!levelQuestions.length) return;

  const clearedIds = await loadClearedIds(tables, scope, levelQuestions);
  if (!levelQuestions.every((q) => clearedIds.has(String(q.id)))) return;

  const scored = await tables.answers.groupBy({
    by: ['result'],
    where: {
      ...scope,
      question_id: { in: levelQuestions.map((q) => q.id) }
    },
    _count: { _all: true }
  });
  const tally = Object.fromEntries(scored.map((r) => [r.result, r._count._all]));

  // The subject is per-bank. The unique key is (kid, subject, topic) and topic
  // is only "<band> level <n>", so a shared subject would make riddle level 1
  // overwrite the child's quiz level 1 achievement.
  // Topic strings written from here on read "all level N". Older rows keep their
  // per-age topic, so a child's history shows a seam at the cutover rather than
  // achievements silently restated to match a later decision.
  const topic = `${WIRE_AGE_BAND} level ${answered.level}`;
  await prisma.kid_learning_progress.upsert({
    where: {
      kid_id_subject_topic: { kid_id: context.kidId, subject: tables.subject, topic }
    },
    create: {
      kid_id: context.kidId,
      subject: tables.subject,
      topic,
      score: tally.correct || 0,
      completed: true,
      metadata: {
        age_band: WIRE_AGE_BAND,
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
        age_band: WIRE_AGE_BAND,
        level: answered.level,
        correct: tally.correct || 0,
        revealed: tally.revealed || 0,
        wrong: tally.wrong || 0,
        questions: levelQuestions.length
      }
    }
  });

  logger.info(
    `[${tables.label}] level complete: kid=${context.kidId} ${topic} correct=${tally.correct || 0}`
  );
};

/**
 * Read-only aggregate over the answer log for the parent portal. Same derived
 * state as the selection path — nothing here is stored.
 *
 * level_total / level_cleared describe the Current Level only, and are what the
 * parent app's quiz card fills its progress bar from. Both are 0 once the band
 * is finished (current_level null), which reads as "nothing left in this level"
 * — the caller decides whether that means complete, because only it knows
 * whether a null level is an achievement or an empty bank.
 *
 * @param {string} deviceMac
 * @param {'quiz'|'riddle'} [bankName]
 * @returns {Promise<{age_band: string, current_level: number|null, levels_completed: number,
 *   level_total: number, level_cleared: number,
 *   counts: Object<string, number>, last_played: Date|null}>}
 */
const progress = async (deviceMac, bankName = DEFAULT_BANK) => {
  const tables = resolveBank(bankName);
  const context = await resolveDeviceContext(deviceMac);
  const scope = answerScope(context);
  const { bank } = await loadBank(tables, context.language);
  const clearedIds = await loadClearedIds(tables, scope, bank);
  const state = deriveLevelState(bank.map((q) => ({ id: q.id, level: q.level })), clearedIds);

  // Counts are lifetime totals for the child, not band-scoped: a band change
  // must not erase what they already answered.
  const grouped = await tables.answers.groupBy({
    by: ['result'],
    where: scope,
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

  const levelQuestions = state.currentLevel === null
    ? []
    : bank.filter((q) => q.level === state.currentLevel);

  return {
    age_band: WIRE_AGE_BAND,
    current_level: state.currentLevel,
    levels_completed: countCompletedLevels(bank, clearedIds),
    level_total: levelQuestions.length,
    level_cleared: levelQuestions.filter((q) => clearedIds.has(String(q.id))).length,
    counts,
    last_played: lastPlayed
  };
};

/**
 * Every device's derived quiz state, for the admin console.
 *
 * Derivation is identical to progress(), but batched: the whole bank and the
 * whole answer log are each read once and joined in memory, so adding devices
 * does not add queries. "Identical" includes the scope: rows are attributed to
 * the child when there is one, exactly as answerScope does, so the console shows
 * what the toy plays. A child with answers but no toy gets a row with an empty
 * `device_mac` — they exist, and their progress is intact.
 *
 * @returns {Promise<Array<{device_mac: string, kid_name: string|null, age_band: string,
 *   age_band_defaulted: boolean, current_level: number|null, levels_completed: number,
 *   max_level: number, replay: boolean, answered_today: number, day_complete: boolean,
 *   correct: number, last_played: Date|null}>>}
 */
const allDeviceProgress = async (bankName = DEFAULT_BANK) => {
  const tables = resolveBank(bankName);
  const [devices, bank, answers] = await Promise.all([
    prisma.ai_device.findMany({
      select: { mac_address: true, kid_id: true },
      orderBy: { mac_address: 'asc' }
    }),
    tables.questions.findMany({
      where: { active: true },
      select: { id: true, level: true, language: true }
    }),
    tables.answers.findMany({
      select: { device_mac: true, kid_id: true, question_id: true, result: true, answered_at: true }
    })
  ]);

  // Children named by a device or by an answer row: the second set is what makes
  // a child who has left their old toy visible at all.
  const kidIdByKey = new Map();
  for (const id of [...devices.map((d) => d.kid_id), ...answers.map((a) => a.kid_id)]) {
    if (id) kidIdByKey.set(String(id), id);
  }
  const kids = kidIdByKey.size
    ? await prisma.kid_profile.findMany({
      where: { id: { in: [...kidIdByKey.values()] } },
      select: { id: true, name: true, birth_date: true, language: true }
    })
    : [];
  const kidById = new Map(kids.map((k) => [String(k.id), k]));

  // The selection path reads the bank for one band in one language; mirror that
  // by keying the in-memory index the same way.
  const bankByBandLang = new Map();
  for (const q of bank) {
    const key = q.language;
    if (!bankByBandLang.has(key)) bankByBandLang.set(key, []);
    bankByBandLang.get(key).push(q);
  }

  // Indexed the two ways answerScope reads: by child for a paired device, by MAC
  // for an unpaired one. The MAC index holds only childless rows, or a
  // hand-me-down would display the previous child's log.
  const answersByKid = new Map();
  const answersByMac = new Map();
  for (const a of answers) {
    const [map, key] = a.kid_id
      ? [answersByKid, String(a.kid_id)]
      : [answersByMac, a.device_mac.toLowerCase()];
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(a);
  }

  // A child who changed toys, or whose toy was unbound, still owns their answers.
  // Without a row of their own the console reads them as never having played,
  // while the toy itself resumes them at the right level.
  const pairedKids = new Set(devices.map((d) => d.kid_id).filter(Boolean).map(String));
  const unpairedKids = [...answersByKid.keys()]
    .filter((key) => !pairedKids.has(key) && kidById.has(key))
    .map((key) => ({ mac_address: '', kid_id: kidIdByKey.get(key) }));

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const now = new Date();
  // Resolved once for the whole page rather than per device: it depends only on
  // which bank is being reported.
  const cleared = clearedResultsFor(tables);

  return [...devices, ...unpairedKids].map((device) => {
    const kid = device.kid_id ? kidById.get(String(device.kid_id)) : null;
    const profileMissing = !kid?.birth_date;
    const language = (kid?.language || DEFAULT_LANGUAGE).toLowerCase();

    const bandBank = bankByBandLang.get(language)
      || bankByBandLang.get(DEFAULT_LANGUAGE)
      || [];
    const bandIds = new Set(bandBank.map((q) => String(q.id)));
    const levelByQuestionId = new Map(bandBank.map((q) => [String(q.id), q.level]));

    const deviceAnswers = (kid
      ? answersByKid.get(String(kid.id))
      : answersByMac.get(device.mac_address.toLowerCase())) || [];
    const clearedIds = new Set(
      deviceAnswers
        .filter((a) => cleared.includes(a.result) && bandIds.has(String(a.question_id)))
        .map((a) => String(a.question_id))
    );

    // Same anti-trap derivation nextQuestions runs, so the card names the level
    // the next session will ACTUALLY serve. Deriving it without the cap printed
    // "level 1" while Quizzy was asking level 2 — the panel and the toy
    // disagreeing about the one thing the panel exists to report.
    const agedOut = agedOutLevels(
      bandBank,
      clearedIds,
      daysByQuestionId(deviceAnswers.filter((a) => bandIds.has(String(a.question_id)))),
      ANTI_TRAP_DAY_CAP
    );
    const state = deriveLevelState(
      bandBank.map((q) => ({ id: q.id, level: q.level })),
      clearedIds,
      agedOut
    );
    const todayIds = deviceAnswers
      .filter((a) => a.answered_at >= startOfDay)
      .map((a) => String(a.question_id));
    const answeredToday = todayIds.length;
    const lastPlayed = deviceAnswers.reduce(
      (max, a) => (!max || a.answered_at > max ? a.answered_at : max),
      null
    );

    return {
      device_mac: device.mac_address,
      kid_name: kid?.name ?? null,
      age_band: WIRE_AGE_BAND,
      age_band_defaulted: profileMissing,
      current_level: state.currentLevel,
      // Mastered levels plus the ones the cap moved the child past — both are
      // levels they will not be asked again. `levels_mastered` keeps the
      // distinction for anyone who needs it; the answer log keeps it in full.
      levels_completed: countCompletedLevels(bandBank, clearedIds, agedOut),
      levels_mastered: countCompletedLevels(bandBank, clearedIds),
      levels_aged_out: agedOut.size,
      max_level: bandBank.length ? Math.max(...bandBank.map((q) => q.level)) : 0,
      // How far into the CURRENT level the device is. Additive, and the one thing
      // the mastery flip made invisible: after 008 a `revealed` answer no longer
      // clears, so "answered ten today" and "cleared the level" came apart. Only
      // the per-level cleared count shows the gap.
      level_size: state.currentLevel === null
        ? 0
        : bandBank.filter((q) => q.level === state.currentLevel).length,
      level_uncleared: state.unclearedIds.length,
      // The anti-trap input, shown rather than inferred: at ANTI_TRAP_DAY_CAP the
      // child moves on whether or not the level was mastered. Counted over the
      // level's UNCLEARED questions only, exactly as agedOutLevels does — days
      // spent on questions already answered right are not days spent stuck.
      days_on_level: state.currentLevel === null ? 0 : new Set(
        deviceAnswers
          .filter((a) => levelByQuestionId.get(String(a.question_id)) === state.currentLevel
            && !clearedIds.has(String(a.question_id)))
          .map((a) => dayKey(a.answered_at))
      ).size,
      anti_trap_cap: ANTI_TRAP_DAY_CAP,
      replay: state.allCleared,
      answered_today: answeredToday,
      day_complete: answeredToday >= DAILY_QUESTION_TARGET
        || levelCompletedToday(bandBank, clearedIds, todayIds),
      // Lifetime, not band-scoped - a band change must not erase what was answered.
      correct: deviceAnswers.filter((a) => a.result === 'correct').length,
      last_played: lastPlayed
    };
  });
};

/**
 * Force a device onto a chosen Level by rewriting its answer log for the band.
 *
 * Admin-only escape hatch for testing: every level below the target is filled
 * with backdated 'correct' rows so it derives as Cleared, and the target level
 * and above are emptied. Rows are dated yesterday so the day-gate stays open -
 * a device set to level 3 can start level 3 immediately.
 *
 * Only the device's OWN band is touched; answers banked under another band
 * survive, the same way loadClearedIds only ever looks at one band.
 *
 * @param {string} deviceMac
 * @param {number} level - target Level, must exist in the band
 * @param {'quiz'|'riddle'} [bankName]
 */
const setLevel = async (deviceMac, level, bankName = DEFAULT_BANK) => {
  const tables = resolveBank(bankName);
  const context = await resolveDeviceContext(deviceMac);
  const { bank, language } = await loadBank(tables, context.language);
  if (!bank.length) {
    throw new ApiError(`no active questions in ${language}`, 400);
  }

  const levels = [...new Set(bank.map((q) => q.level))].sort((a, b) => a - b);
  if (!levels.includes(level)) {
    throw new ApiError(
      `level ${level} does not exist in ${language} (have: ${levels.join(', ')})`,
      400
    );
  }

  const belowTarget = bank.filter((q) => q.level < level);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Scoped the same way reads are, or forcing a level on a paired device would
  // delete nothing it can see and write rows it cannot read back.
  const scope = answerScope(context);
  const deleted = await tables.answers.deleteMany({
    where: { ...scope, question_id: { in: bank.map((q) => q.id) } }
  });
  const created = belowTarget.length
    ? await tables.answers.createMany({
      data: belowTarget.map((q) => ({
        device_mac: deviceMac,
        kid_id: context.kidId,
        question_id: q.id,
        result: 'correct',
        answered_at: yesterday
      }))
    })
    : { count: 0 };

  return {
    device_mac: deviceMac,
    age_band: WIRE_AGE_BAND,
    level,
    deleted: deleted.count,
    cleared: created.count
  };
};

/**
 * Re-open today's Daily Ten without losing progress: every row for the device
 * slides back one day, so today becomes yesterday and the whole log with it.
 *
 * Cleared and answered_today read the same rows, so DELETING today's answers
 * would also un-clear the level and drop the device back. Shifting the
 * timestamps keeps every level Cleared while answered_today falls to zero.
 *
 * WHY THE WHOLE LOG AND NOT JUST TODAY'S ROWS. This used to move only
 * `answered_at >= startOfDay`, which re-opened the gate but silently FLATTENED
 * the day count the anti-trap reads (`daysOnLevel`, three distinct days and the
 * child advances). Play, reset, play, reset and both sessions land on the same
 * backdated day: the count stays at 1 and the cap can never be reached by
 * testing. Sliding everything keeps the gaps BETWEEN sessions intact, which is
 * the only property that matters — one press is one simulated night.
 *
 * @param {string} deviceMac
 * @param {'quiz'|'riddle'} [bankName]
 */
const clearDayGate = async (deviceMac, bankName = DEFAULT_BANK) => {
  const tables = resolveBank(bankName);
  const context = await resolveDeviceContext(deviceMac);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const scope = answerScope(context);
  // Nothing answered today means the gate is already open, and sliding anyway
  // would just age the log a day for no reason — and quietly move the anti-trap
  // further away with every idle press.
  const today = await tables.answers.count({
    where: { ...scope, answered_at: { gte: startOfDay } }
  });
  if (!today) return { device_mac: deviceMac, backdated: 0, day_already_open: true };

  // Two statements rather than one, because the scope is a different column
  // depending on whether the device is paired. Same rule as answerScope: a
  // paired device backdates its child's rows wherever they were answered; an
  // unpaired one may only touch rows no child owns.
  // $executeRawUnsafe, not a tagged template: a table name cannot be a bound
  // parameter. Only the table name is interpolated and it comes from the bank
  // registry, never from the caller; both values stay bound.
  const moved = context.kidId
    ? await prisma.$executeRawUnsafe(
      `UPDATE ${tables.answerTable}
       SET answered_at = answered_at - INTERVAL '1 day'
       WHERE kid_id = $1`,
      context.kidId
    )
    : await prisma.$executeRawUnsafe(
      `UPDATE ${tables.answerTable}
       SET answered_at = answered_at - INTERVAL '1 day'
       WHERE kid_id IS NULL
         AND lower(device_mac) = lower($1)`,
      deviceMac
    );

  return { device_mac: deviceMac, backdated: moved };
};

module.exports = {
  recordUnresolvedAttempts,
  recordWonderQuestion,
  lastWonderQuestion,
  // Exported for tests: the Door ladder is the part of the payload most likely
  // to be got wrong quietly.
  toQuestion,
  choiceOrderFor,
  ASK_MODES,
  nextQuestions,
  recordAnswer,
  recordAttempts,
  progress,
  allDeviceProgress,
  setLevel,
  clearDayGate
};
