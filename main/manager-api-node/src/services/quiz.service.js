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
const { ageBandFromBirthDate, deriveLevelState, countCompletedLevels, levelCompletedToday } = require('./quiz.logic');
const { resolveBank, clearedResultsFor, DEFAULT_BANK } = require('./banks');

// Used when there is no device row, no kid, or no birth date. Still the middle
// of the authored range, now that a band is a single age (see quiz.logic).
const DEFAULT_AGE_BAND = '6';
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

  const ageBand = ageBandFromBirthDate(kid?.birth_date ?? null, new Date());

  return {
    ageBand: ageBand || DEFAULT_AGE_BAND,
    ageBandDefaulted: ageBand === null,
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
const loadBank = async (tables, ageBand, language) => {
  const query = (lang) => tables.questions.findMany({
    where: { age_band: ageBand, language: lang, active: true },
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
 * @param {'quiz'|'riddle'} [bankName]
 * @returns {Promise<{age_band: string, age_band_defaulted: boolean, language: string,
 *   level: number|null, replay: boolean, frontier_warning: boolean, questions: Array}>}
 */
const nextQuestions = async (deviceMac, bankName = DEFAULT_BANK) => {
  const tables = resolveBank(bankName);
  const context = await resolveDeviceContext(deviceMac);
  const scope = answerScope(context);
  const { bank, language } = await loadBank(tables, context.ageBand, context.language);
  const clearedIds = await loadClearedIds(tables, scope, bank);
  const state = deriveLevelState(bank.map((q) => ({ id: q.id, level: q.level })), clearedIds);

  let level = state.currentLevel;
  let selectedIds = state.unclearedIds;
  const replay = state.allCleared;

  if (replay) {
    level = await leastRecentlyPlayedLevel(tables, scope, bank);
    selectedIds = bank.filter((q) => q.level === level).map((q) => q.id);
  }

  const maxLevel = bank.length ? Math.max(...bank.map((q) => q.level)) : 0;
  const frontierWarning = level !== null && !replay && maxLevel - level < FRONTIER_WARN_LEVELS;
  if (frontierWarning || replay) {
    logger.warn(
      `[${tables.label}] device ${deviceMac} at the authored frontier: level=${level} max_level=${maxLevel} band=${context.ageBand} replay=${replay}`
    );
  }

  const selected = new Set(selectedIds.map(String));

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

  return {
    age_band: context.ageBand,
    age_band_defaulted: context.ageBandDefaulted,
    language,
    level,
    replay,
    frontier_warning: frontierWarning,
    answered_today: answeredToday,
    day_complete: dayComplete,
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
 * @param {'quiz'|'riddle'} [bankName]
 * @returns {Promise<{id: string, question_id: string, result: string, answered_at: Date}>}
 */
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
    select: { id: true }
  });
  if (!question) {
    throw new ApiError(`unknown question_id: ${questionId}`, 400);
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
    select: { age_band: true, level: true, language: true }
  });
  if (!answered) return;

  const { bank } = await loadBank(tables, answered.age_band, context.language);
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
  const topic = `${answered.age_band} level ${answered.level}`;
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
  const { bank } = await loadBank(tables, context.ageBand, context.language);
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
    age_band: context.ageBand,
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
      select: { id: true, age_band: true, level: true, language: true }
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
    const key = `${q.age_band}|${q.language}`;
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
    const derivedBand = ageBandFromBirthDate(kid?.birth_date ?? null, now);
    const ageBand = derivedBand || DEFAULT_AGE_BAND;
    const language = (kid?.language || DEFAULT_LANGUAGE).toLowerCase();

    const bandBank = bankByBandLang.get(`${ageBand}|${language}`)
      || bankByBandLang.get(`${ageBand}|${DEFAULT_LANGUAGE}`)
      || [];
    const bandIds = new Set(bandBank.map((q) => String(q.id)));

    const deviceAnswers = (kid
      ? answersByKid.get(String(kid.id))
      : answersByMac.get(device.mac_address.toLowerCase())) || [];
    const clearedIds = new Set(
      deviceAnswers
        .filter((a) => cleared.includes(a.result) && bandIds.has(String(a.question_id)))
        .map((a) => String(a.question_id))
    );

    const state = deriveLevelState(
      bandBank.map((q) => ({ id: q.id, level: q.level })),
      clearedIds
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
      age_band: ageBand,
      age_band_defaulted: derivedBand === null,
      current_level: state.currentLevel,
      levels_completed: countCompletedLevels(bandBank, clearedIds),
      max_level: bandBank.length ? Math.max(...bandBank.map((q) => q.level)) : 0,
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
  const { bank } = await loadBank(tables, context.ageBand, context.language);
  if (!bank.length) {
    throw new ApiError(`no active questions for band ${context.ageBand}`, 400);
  }

  const levels = [...new Set(bank.map((q) => q.level))].sort((a, b) => a - b);
  if (!levels.includes(level)) {
    throw new ApiError(
      `level ${level} does not exist in band ${context.ageBand} (have: ${levels.join(', ')})`,
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
    age_band: context.ageBand,
    level,
    deleted: deleted.count,
    cleared: created.count
  };
};

/**
 * Re-open today's Daily Ten without losing progress.
 *
 * Cleared and answered_today read the same rows, so DELETING today's answers
 * would also un-clear the level and drop the device back. Shifting the
 * timestamps back a day keeps every level Cleared while answered_today falls
 * to zero, which is the only way to reach the next level on the same day.
 *
 * @param {string} deviceMac
 * @param {'quiz'|'riddle'} [bankName]
 */
const clearDayGate = async (deviceMac, bankName = DEFAULT_BANK) => {
  const tables = resolveBank(bankName);
  const context = await resolveDeviceContext(deviceMac);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

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
       WHERE kid_id = $1
         AND answered_at >= $2`,
      context.kidId,
      startOfDay
    )
    : await prisma.$executeRawUnsafe(
      `UPDATE ${tables.answerTable}
       SET answered_at = answered_at - INTERVAL '1 day'
       WHERE kid_id IS NULL
         AND lower(device_mac) = lower($1)
         AND answered_at >= $2`,
      deviceMac,
      startOfDay
    );

  return { device_mac: deviceMac, backdated: moved };
};

module.exports = {
  nextQuestions,
  recordAnswer,
  recordAttempts,
  progress,
  allDeviceProgress,
  setLevel,
  clearDayGate
};
