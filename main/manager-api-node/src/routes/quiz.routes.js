/**
 * Quiz Routes
 *
 * Quizzy Question Bank. Base path: /quiz
 *
 * - GET  /quiz/next-questions - next scored batch for a device (worker PULL)
 * - POST /quiz/answer         - log one answered question (worker PUSH)
 * - GET  /quiz/progress       - answer-log aggregate for the parent portal
 */

const express = require('express');
const router = express.Router();
const quizService = require('../services/quiz.service');
const { bankFor, BANKS } = require('../services/banks');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireServiceKey, requireAuth } = require('../middleware/auth');
const { success, created, badRequest } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * @swagger
 * /quiz/next-questions:
 *   get:
 *     tags: [Quiz]
 *     summary: Next scored question batch for a device (worker PULL)
 *     description: Returns the current Level's uncleared active questions for the
 *       device's Age Band and language. Nothing is written on fetch. When every
 *       level in the band is cleared, returns the least recently played level's
 *       full set with replay=true. Service-key auth.
 *     parameters:
 *       - in: query
 *         name: device_mac
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: character
 *         required: false
 *         description: Character agent_code (e.g. riddle_master) selecting the question
 *           bank. Absent or unrecognised falls back to the quiz bank.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Question batch (questions may be empty when the bank has no content for the band)
 *       400:
 *         description: device_mac missing
 */
router.get('/next-questions',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const deviceMac = String(req.query.device_mac || '').trim();
    if (!deviceMac) {
      return badRequest(res, 'device_mac is required');
    }

    const bank = bankFor(String(req.query.character || '').trim());
    const batch = await quizService.nextQuestions(deviceMac, bank);
    logger.info(
      `[QUIZ] GET /quiz/next-questions device=${deviceMac} bank=${bank} -> band=${batch.age_band} level=${batch.level} replay=${batch.replay} questions=${batch.questions.length}`
    );
    // Echoed so the worker can send it back on /quiz/answer without having to
    // know the character-to-bank mapping itself.
    return success(res, { ...batch, bank });
  })
);

/**
 * @swagger
 * /quiz/answer:
 *   post:
 *     tags: [Quiz]
 *     summary: Log one answered question (worker PUSH)
 *     description: Inserts a single quiz_question_answer row. Results 'correct' and
 *       'revealed' Clear the question, so next-questions stops offering it. Called
 *       per question in real time. Service-key auth.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [device_mac, question_id, result]
 *             properties:
 *               device_mac:
 *                 type: string
 *               question_id:
 *                 type: string
 *                 description: Question id, sent as a string (BigInt ids are not JSON-serialisable)
 *               result:
 *                 type: string
 *                 enum: [correct, wrong, revealed]
 *               bank:
 *                 type: string
 *                 enum: [quiz, riddle]
 *                 description: Which bank the question came from, as echoed by
 *                   next-questions. Absent falls back to the quiz bank.
 *               character:
 *                 type: string
 *                 description: Character agent_code, used only when bank is absent.
 *     responses:
 *       201:
 *         description: Answer logged
 *       400:
 *         description: Missing field, bad result, unknown bank, or unknown question_id
 */
router.post('/answer',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const deviceMac = String(req.body.device_mac || '').trim();
    const questionId = String(req.body.question_id ?? '').trim();
    const result = String(req.body.result || '').trim();

    if (!deviceMac) {
      return badRequest(res, 'device_mac is required');
    }
    if (!questionId) {
      return badRequest(res, 'question_id is required');
    }
    if (!result) {
      return badRequest(res, 'result is required');
    }

    // An explicit bank wins: it is what next-questions actually served. The
    // character is only a fallback for a caller that did not echo it. An
    // unrecognised bank is a 400 rather than a silent write to the quiz log.
    const explicitBank = String(req.body.bank || '').trim();
    if (explicitBank && !BANKS[explicitBank]) {
      return badRequest(res, `bank must be one of: ${Object.keys(BANKS).join(', ')}`);
    }
    const bank = explicitBank || bankFor(String(req.body.character || '').trim());

    const answer = await quizService.recordAnswer(deviceMac, questionId, result, bank);
    logger.info(
      `[QUIZ] POST /quiz/answer device=${deviceMac} bank=${bank} question=${answer.question_id} result=${answer.result}`
    );
    return created(res, { ...answer, bank }, 'Answer logged');
  })
);

/**
 * @swagger
 * /quiz/progress:
 *   get:
 *     tags: [Quiz]
 *     summary: Answer-log aggregate for a device (parent portal)
 *     description: Read-only. current_level is the derived Current Level, null once
 *       every level in the band is cleared; levels_completed counts the levels whose
 *       active questions are all Cleared; counts are lifetime totals. Service-key auth.
 *     parameters:
 *       - in: query
 *         name: device_mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Progress summary
 *       400:
 *         description: device_mac missing
 */
router.get('/progress',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const deviceMac = String(req.query.device_mac || '').trim();
    if (!deviceMac) {
      return badRequest(res, 'device_mac is required');
    }

    const bank = bankFor(String(req.query.character || '').trim());
    const summary = await quizService.progress(deviceMac, bank);
    logger.info(
      `[QUIZ] GET /quiz/progress device=${deviceMac} bank=${bank} -> band=${summary.age_band} level=${summary.current_level} completed=${summary.levels_completed}`
    );
    return success(res, { ...summary, bank });
  })
);

/**
 * @swagger
 * /quiz/admin/devices:
 *   get:
 *     tags: [Quiz]
 *     summary: Derived quiz state for every device (admin console)
 *     description: Read-only. One row per device with its Age Band, Current Level,
 *       levels completed and today's answered count. Logged-in admin auth.
 *     responses:
 *       200:
 *         description: One entry per device
 */
router.get('/admin/devices',
  requireAuth,
  asyncHandler(async (req, res) => {
    const bank = String(req.query.bank || '').trim() || undefined;
    if (bank && !BANKS[bank]) {
      return badRequest(res, `bank must be one of: ${Object.keys(BANKS).join(', ')}`);
    }
    const rows = await quizService.allDeviceProgress(bank);
    return success(res, rows);
  })
);

/**
 * @swagger
 * /quiz/admin/set-level:
 *   post:
 *     tags: [Quiz]
 *     summary: Force a device onto a chosen Level (admin console)
 *     description: Rewrites the device's answer log for its band - levels below the
 *       target become Cleared with backdated rows, the target and above are emptied.
 *       Destructive; intended for testing. Logged-in admin auth.
 *     responses:
 *       200:
 *         description: Level set
 *       400:
 *         description: Missing device_mac, bad level, or level absent from the band
 */
router.post('/admin/set-level',
  requireAuth,
  asyncHandler(async (req, res) => {
    const deviceMac = String(req.body.device_mac || '').trim();
    const level = Number(req.body.level);

    if (!deviceMac) {
      return badRequest(res, 'device_mac is required');
    }
    if (!Number.isInteger(level) || level < 1) {
      return badRequest(res, 'level must be a positive integer');
    }

    const bank = String(req.body.bank || '').trim() || undefined;
    if (bank && !BANKS[bank]) {
      return badRequest(res, `bank must be one of: ${Object.keys(BANKS).join(', ')}`);
    }

    const result = await quizService.setLevel(deviceMac, level, bank);
    logger.info(
      `[QUIZ] admin set-level device=${deviceMac} bank=${bank || 'quiz'} band=${result.age_band} level=${level} deleted=${result.deleted} cleared=${result.cleared}`
    );
    return success(res, result);
  })
);

/**
 * @swagger
 * /quiz/admin/reset-day:
 *   post:
 *     tags: [Quiz]
 *     summary: Re-open today's Daily Ten without losing progress (admin console)
 *     description: Backdates today's answer rows by one day. Levels stay Cleared while
 *       answered_today drops to zero, so the device can start the next level today.
 *       Logged-in admin auth.
 *     responses:
 *       200:
 *         description: Rows backdated
 *       400:
 *         description: device_mac missing
 */
router.post('/admin/reset-day',
  requireAuth,
  asyncHandler(async (req, res) => {
    const deviceMac = String(req.body.device_mac || '').trim();
    if (!deviceMac) {
      return badRequest(res, 'device_mac is required');
    }

    const bank = String(req.body.bank || '').trim() || undefined;
    if (bank && !BANKS[bank]) {
      return badRequest(res, `bank must be one of: ${Object.keys(BANKS).join(', ')}`);
    }

    const result = await quizService.clearDayGate(deviceMac, bank);
    logger.info(
      `[QUIZ] admin reset-day device=${deviceMac} bank=${bank || 'quiz'} backdated=${result.backdated}`
    );
    return success(res, result);
  })
);

module.exports = router;
